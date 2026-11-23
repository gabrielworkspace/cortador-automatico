# -*- coding: utf-8 -*-
"""
Separa a voz da musica de fundo com Demucs e grava as duas faixas em WAV.

Serve pra quando a live tem musica tocando e o TikTok derruba o corte por
direito autoral: o corte e remontado so com a faixa de voz.

Reporta progresso em stdout, uma linha JSON por vez, igual ao transcrever.py.
"""
import argparse
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


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--voz", required=True, help="WAV so com a voz")
    p.add_argument("--resto", default="", help="WAV com o que sobrou (musica/ambiente)")
    p.add_argument("--modelo", default="htdemucs")
    args = p.parse_args()

    try:
        import torch
        from demucs.api import Separator, save_audio
    except ImportError as e:
        avisar("erro", msg="demucs nao instalado (%s). Rode: py -3 -m pip install demucs" % e)
        sys.exit(2)

    avisar("progresso", pct=3, msg="Carregando o modelo de separacao (%s)..." % args.modelo)

    usar_gpu = os.environ.get("USAR_GPU") == "1" and torch.cuda.is_available()
    dispositivo = "cuda" if usar_gpu else "cpu"
    if dispositivo == "cpu":
        # Em CPU o demucs usa todos os nucleos por padrao e trava a maquina.
        # Deixa um livre pra maquina continuar respondendo.
        nucleos = max(1, (os.cpu_count() or 2) - 1)
        torch.set_num_threads(nucleos)

    try:
        sep = Separator(model=args.modelo, device=dispositivo, progress=True, jobs=1)
    except Exception as e:
        if dispositivo == "cuda":
            nucleos = max(1, (os.cpu_count() or 2) - 1)
            torch.set_num_threads(nucleos)
            try:
                sep = Separator(model=args.modelo, device="cpu", progress=True, jobs=1)
            except Exception as e2:
                avisar("erro", msg="nao consegui carregar o modelo: %s" % e2)
                sys.exit(3)
        else:
            avisar("erro", msg="nao consegui carregar o modelo: %s" % e)
            sys.exit(3)

    avisar("progresso", pct=10, msg="Separando voz e musica (demora)...")
    try:
        _, faixas = sep.separate_audio_file(args.audio)
    except Exception as e:
        avisar("erro", msg="falha na separacao: %s" % e)
        sys.exit(4)

    if "vocals" not in faixas:
        avisar("erro", msg="o modelo nao devolveu faixa de voz: %s" % list(faixas))
        sys.exit(5)

    sr = sep.samplerate
    save_audio(faixas["vocals"], args.voz, samplerate=sr)
    avisar("progresso", pct=92, msg="Voz gravada.")

    # O resto so interessa pra conferir o que foi tirado - nao entra no corte.
    if args.resto:
        sobra = None
        for nome, faixa in faixas.items():
            if nome == "vocals":
                continue
            sobra = faixa if sobra is None else sobra + faixa
        if sobra is not None:
            save_audio(sobra, args.resto, samplerate=sr)

    avisar("pronto", voz=args.voz, resto=args.resto, taxa=sr, faixas=list(faixas))


if __name__ == "__main__":
    main()
