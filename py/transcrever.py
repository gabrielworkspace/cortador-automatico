# -*- coding: utf-8 -*-
"""
Transcreve um audio com faster-whisper e grava um JSON com timestamps por palavra.
Reporta progresso em stdout, uma linha JSON por vez, para o Node acompanhar.
"""
import argparse
import glob
import io
import json
import os
import sys

# Windows costuma abrir o stdout em cp1252 e quebrar com acento.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def avisar(tipo, **campos):
    campos["tipo"] = tipo
    print(json.dumps(campos, ensure_ascii=False), flush=True)


def registrar_dlls_cuda():
    """Garante que o ctranslate2 ache cublas64_12.dll / cudnn no Windows."""
    if sys.platform != "win32":
        return
    pastas = []
    # CUDA Toolkit 12.x instalado no sistema (necessario pro ctranslate2 4.x)
    cuda_env = os.environ.get("CUDA_PATH")
    if cuda_env:
        pastas.append(os.path.join(cuda_env, "bin"))
    for chave, valor in sorted(os.environ.items(), reverse=True):
        if chave.startswith("CUDA_PATH_V12") and valor:
            pastas.append(os.path.join(valor, "bin"))
    base_nv = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "NVIDIA GPU Computing Toolkit", "CUDA")
    if os.path.isdir(base_nv):
        for v in sorted(glob.glob(os.path.join(base_nv, "v12.*", "bin")), reverse=True):
            pastas.append(v)
    # Pacotes pip nvidia-cublas-cu12 / nvidia-cudnn-cu12, se instalados
    for base in sys.path:
        if not base or not os.path.isdir(base):
            continue
        for d in glob.glob(os.path.join(base, "nvidia", "*", "bin")):
            pastas.append(d)

    vistos = set()
    path_atual = os.environ.get("PATH", "")
    extras = []
    for d in pastas:
        norm = os.path.normcase(os.path.abspath(d))
        if norm in vistos or not os.path.isdir(d):
            continue
        vistos.add(norm)
        try:
            os.add_dll_directory(d)
        except Exception:
            pass
        extras.append(d)
    if extras:
        os.environ["PATH"] = os.pathsep.join(extras) + os.pathsep + path_atual


def escolher_compute_type_cuda():
    """
    Descobre o melhor tipo numerico pra GPU NVIDIA deste PC.
    Pascal (sm_61, ex.: GTX 10xx) nao suporta float16 no ctranslate2,
    entao cai naturalmente em int8_float32; Turing/Ampere/Ada/Blackwell usam float16.
    """
    registrar_dlls_cuda()
    import ctranslate2
    if ctranslate2.get_cuda_device_count() <= 0:
        return None
    suportados = set(ctranslate2.get_supported_compute_types("cuda"))
    for ct in ("float16", "int8_float16", "int8_float32", "int8", "float32"):
        if ct in suportados:
            return ct
    return None


def testar_cuda():
    """Modo rapido (--testar-cuda) chamado pelo Node pra conferir se a GPU funciona de verdade."""
    try:
        ct = escolher_compute_type_cuda()
        if not ct:
            print(json.dumps({"cuda": False, "motivo": "sem dispositivo cuda"}, ensure_ascii=False))
            return
        import ctranslate2
        print(json.dumps({
            "cuda": True,
            "dispositivos": ctranslate2.get_cuda_device_count(),
            "compute_type": ct,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"cuda": False, "motivo": str(e)[:200]}, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=False)
    p.add_argument("--saida", required=False)
    p.add_argument("--modelo", default="small")
    p.add_argument("--idioma", default="pt")  # o programa e pra cortes brasileiros
    p.add_argument("--duracao", type=float, default=0.0)
    p.add_argument("--testar-cuda", action="store_true")
    args = p.parse_args()

    if args.testar_cuda:
        testar_cuda()
        return

    if not args.audio or not args.saida:
        avisar("erro", msg="Parametros --audio e --saida sao obrigatorios.")
        sys.exit(2)

    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError as e:
        # falta o proprio faster-whisper (ou uma dependencia) NESTE Python
        avisar("erro", msg="faster-whisper nao instalado no Python " + sys.executable +
               " (" + str(e) + "). Rode o instalar.bat de novo: ele cria um Python so do programa.")
        sys.exit(2)
    except (ImportError, OSError) as e:
        # instalado, mas nao abre: quase sempre falta o Visual C++ do Windows
        avisar("erro", msg="O faster-whisper esta instalado mas nao abre neste PC (" + str(e)[:160] +
               "). Instale o Visual C++ (https://aka.ms/vs/17/release/vc_redist.x64.exe) e abra o programa de novo.")
        sys.exit(2)

    avisar("progresso", pct=2, msg="Carregando o modelo de transcricao (%s)..." % args.modelo)

    # Em container, os.cpu_count() ve os nucleos do HOST, nao a cota da
    # maquina (cgroup) - pedir threads demais deixa mais lento, nao mais
    # rapido. NUM_THREADS deixa o dono do servidor fixar o numero certo.
    threads_do_ambiente = os.environ.get("NUM_THREADS")
    if threads_do_ambiente:
        threads = max(1, int(threads_do_ambiente))
    else:
        threads = max(1, (os.cpu_count() or 4) - 2)

    # MODELOS_DIR aponta pro modelo ja assado na imagem do container (o
    # instalar.bat baixa uma vez). Sem isso, cada job baixaria ~500 MB de
    # novo do HuggingFace numa pasta que some a cada deploy.
    pasta_modelos = os.environ.get("MODELOS_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "modelos"
    )

    # Quando a placa de video esta ligada e o PC tem GPU NVIDIA com CUDA,
    # carrega o Whisper na GPU (em Pascal sm_61 como GTX 10xx usa
    # int8_float32; em GPUs mais novas usa float16). Se falhar, cai pro CPU.
    modelo = None
    usou_cuda = False
    if os.environ.get("USAR_GPU") == "1":
        try:
            ct = escolher_compute_type_cuda()
            if ct:
                avisar("progresso", pct=3, msg="Carregando o modelo na placa de video (CUDA/%s)..." % ct)
                modelo = WhisperModel(
                    args.modelo,
                    device="cuda",
                    compute_type=ct,
                    download_root=pasta_modelos,
                )
                usou_cuda = True
        except Exception as e:
            avisar("progresso", pct=4, msg="CUDA indisponivel (%s), usando o processador..." % str(e)[:120])
            modelo = None

    if modelo is None:
        # int8 no CPU: bem mais rapido e cabe folgado na RAM.
        modelo = WhisperModel(
            args.modelo,
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            download_root=pasta_modelos,
        )

    avisar("progresso", pct=6, msg="Ouvindo o video inteiro%s..." % (" (GPU)" if usou_cuda else ""))

    opcoes = dict(
        language=(None if args.idioma == "auto" else args.idioma),
        task="transcribe",
        beam_size=1,                           # greedy: ~2x mais rapido no CPU e quase a mesma qualidade
        best_of=1,
        temperature=0.0,
        vad_filter=True,                       # corta silencio, acelera e evita alucinacao
        vad_parameters={"min_silence_duration_ms": 400},
        word_timestamps=True,                  # precisamos disso pro corte e pra legenda
        condition_on_previous_text=False,      # evita o modelo repetir frase em loop
    )

    # Audio longo (live de 3, 10 horas) vai em pedacos: o faster-whisper
    # carrega o arquivo inteiro na memoria, e 6h de audio viram 1,5 GB antes
    # de comecar - numa maquina com pouca RAM livre o processo morre.
    pedacos = pedacos_do_wav(args.audio, args.duracao) if args.duracao > LIMITE_INTEIRO else None
    if pedacos is None:
        # O audio vai ja lido (numeros), e nao o caminho do arquivo: com o
        # caminho o faster-whisper abre o arquivo pelo PyAV, e o PyAV 19 quebrou
        # isso ("open() got an unexpected keyword argument 'metadata_errors'").
        lido = ler_wav(args.audio)
        entrada = lido if lido is not None else args.audio
        segmentos_iter, info = modelo.transcribe(entrada, **opcoes)
        duracao = args.duracao or float(getattr(info, "duration", 0) or 0)
        idioma = getattr(info, "language", None) or opcoes["language"] or args.idioma
        fontes = [(0.0, segmentos_iter, float("inf"))]
    else:
        duracao = args.duracao
        # o idioma sai do primeiro pedaco e vale pra live inteira: cada pedaco
        # descobrindo o seu poderia trocar de lingua no meio
        primeiro = next(pedacos, None)
        if primeiro is None:
            avisar("erro", msg="Nao encontrei fala nenhuma no audio desse video.")
            sys.exit(3)
        idioma = opcoes["language"] or descobrir(modelo, primeiro[1])[0] or args.idioma
        opcoes["language"] = idioma

        def todos():
            yield primeiro
            for p_ in pedacos:
                yield p_
        fontes = ((inicio, modelo.transcribe(audio, **opcoes)[0], limite)
                  for inicio, audio, limite in todos())

    segmentos = []
    ultimo_aviso = 0.0
    for deslocamento, segmentos_iter, limite in fontes:
        # o pedaco comeca uns segundos antes do fim do anterior: o que ja foi
        # ouvido la fica de fora, pra frase da emenda nao sair repetida
        ja_ouvido = segmentos[-1]["fim"] - 0.1 if segmentos else -1.0
        for s in segmentos_iter:
            if deslocamento + float(s.start) < ja_ouvido:
                continue
            # frase que termina colada no fim do pedaco pode ter sido cortada
            # no meio: o proximo pedaco, que comeca antes, ouve ela inteira
            if deslocamento + float(s.end) > limite:
                break
            palavras = []
            for w in (s.words or []):
                texto = (w.word or "").strip()
                if not texto:
                    continue
                palavras.append({
                    "inicio": round(deslocamento + float(w.start), 3),
                    "fim": round(deslocamento + float(w.end), 3),
                    "texto": texto,
                    "conf": round(float(getattr(w, "probability", 0.0) or 0.0), 3),
                })

            fim = deslocamento + float(s.end)
            segmentos.append({
                "inicio": round(deslocamento + float(s.start), 3),
                "fim": round(fim, 3),
                "texto": (s.text or "").strip(),
                "palavras": palavras,
            })

            # 6% -> 92% conforme caminha na linha do tempo do video
            if duracao > 0 and (fim - ultimo_aviso) > 3:
                ultimo_aviso = fim
                pct = 6 + min(86.0, (fim / duracao) * 86.0)
                avisar("progresso", pct=round(pct, 1),
                       msg="Transcrevendo... %s de %s" % (mmss(fim), mmss(duracao)))

    total_palavras = sum(len(s["palavras"]) for s in segmentos)
    if total_palavras == 0:
        avisar("erro", msg="Nao encontrei fala nenhuma no audio desse video.")
        sys.exit(3)

    with open(args.saida, "w", encoding="utf-8") as f:
        json.dump({
            "idioma": idioma,
            "duracao": duracao,
            "segmentos": segmentos,
        }, f, ensure_ascii=False)

    avisar("progresso", pct=94, msg="Transcricao pronta: %d palavras." % total_palavras)
    avisar("ok", palavras=total_palavras, segmentos=len(segmentos))


def descobrir(modelo, audio):
    """Que lingua se fala no audio: (codigo, certeza de 0 a 1). Falhou: (None, 0)."""
    try:
        _, info = modelo.transcribe(audio, language=None, task="transcribe", beam_size=1,
                                    vad_filter=True, vad_parameters={"min_silence_duration_ms": 400})
        return getattr(info, "language", None), float(getattr(info, "language_probability", 0) or 0)
    except Exception:
        return None, 0.0


def mmss(s):
    s = int(s or 0)
    return "%d:%02d" % (s // 60, s % 60)


# Acima disso o audio vai em pedacos. Video comum continua do jeito de sempre.
LIMITE_INTEIRO = 40 * 60
PEDACO = 10 * 60
EMENDA = 8  # segundos que cada pedaco repete do anterior, pra nao cortar palavra


def ler_wav(caminho):
    """
    O WAV inteiro (16 kHz mono, o que o programa grava) como numeros de -1 a 1,
    do jeito que o faster-whisper aceita. Outro formato: None.
    """
    import wave
    try:
        with wave.open(caminho, "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16000:
                return None
            bruto = w.readframes(w.getnframes())
    except Exception:
        return None
    import numpy as np
    return np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0


def pedacos_do_wav(caminho, duracao):
    """
    Le o WAV (16 kHz mono, o que o programa grava) aos pedacos de 10 min,
    cada um comecando 8s antes do fim do anterior. Se o arquivo nao for
    desse formato, devolve None e a transcricao segue do jeito inteiro.
    """
    import wave
    try:
        w = wave.open(caminho, "rb")
    except Exception:
        return None
    if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16000:
        w.close()
        return None

    def gerar():
        import numpy as np
        taxa = 16000
        total = w.getnframes()
        inicio = 0
        try:
            while inicio < total:
                w.setpos(inicio)
                bruto = w.readframes(min(PEDACO * taxa, total - inicio))
                if not bruto:
                    break
                audio = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0
                ultimo = inicio + PEDACO * taxa >= total
                comeco = inicio / float(taxa)
                limite = float("inf") if ultimo else comeco + PEDACO - EMENDA / 2.0
                yield comeco, audio, limite
                if ultimo:
                    break
                inicio += (PEDACO - EMENDA) * taxa
        finally:
            w.close()

    return gerar()


if __name__ == "__main__":
    main()
