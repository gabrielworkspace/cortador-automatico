# -*- coding: utf-8 -*-
"""
Logo do AUTOCORTES Z (OZBITS): tesoura branca com fogo, vetor 2D chapado.
As formas sao definidas aqui uma vez e saem em dois formatos iguais:
  - instalador/imagens/logo.svg  (vetor, escala infinita)
  - PNG/ICO/BMP (via icone.py, que importa desta funcao)

    python instalador/logo.py        (precisa do Pillow)
"""
import math
import os

from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "imagens")

FUNDO_TOPO = (27, 31, 58)
FUNDO_BASE = (12, 14, 28)
LARANJA_BASE = (255, 61, 0)
LARANJA_TOPO = (255, 145, 0)
AMARELO_BASE = (255, 171, 0)
AMARELO_TOPO = (255, 236, 130)

PIVO = (256, 272)
ESCALA = 0.88
ABERTURA = 21  # graus

# Chama externa e interna: curvas cubicas (ponto inicial + segmentos de 3 pontos), coordenadas 512x512
CHAMA_EXT = [(256, 48), [(262, 112), (352, 150), (352, 240)], [(352, 324), (310, 376), (256, 376)],
             [(202, 376), (160, 324), (160, 240)], [(160, 186), (196, 166), (206, 122)],
             [(230, 140), (248, 104), (256, 48)]]
CHAMA_INT = [(256, 176), [(260, 226), (312, 248), (312, 304)], [(312, 346), (288, 370), (256, 370)],
             [(224, 370), (200, 346), (200, 304)], [(200, 264), (236, 242), (256, 176)]]


def _bezier(p0, p1, p2, p3, n=40):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return out


def _contorno(chama):
    pts = [chama[0]]
    atual = chama[0]
    for seg in chama[1:]:
        pts += _bezier(atual, seg[0], seg[1], seg[2])
        atual = seg[2]
    return pts


def _svg_path(chama):
    d = "M%g,%g" % chama[0]
    for seg in chama[1:]:
        d += " C" + " ".join("%g,%g" % p for p in seg)
    return d + " Z"


def _metade(sinal):
    """Uma metade da tesoura (lamina + haste + argola) ja posicionada. sinal=-1 esquerda, +1 direita."""
    ang = math.radians(sinal * ABERTURA)
    c, s = math.cos(ang), math.sin(ang)

    def pos(x, y):
        x, y = x * ESCALA, y * ESCALA
        return (PIVO[0] + x * c - y * s, PIVO[1] + x * s + y * c)

    lamina = [pos(*p) for p in [(-23, 14), (23, 14), (8, -200), (0, -214), (-8, -200)]]
    haste = [pos(*p) for p in [(-12, 0), (12, 0), (12, 104), (-12, 104)]]
    centro = pos(0, 152)
    return lamina, haste, centro, 53 * ESCALA, 32 * ESCALA


def svg():
    esq, dire = _metade(-1), _metade(1)
    partes = []
    for lamina, haste, (cx, cy), re, ri in (esq, dire):
        partes.append('<polygon points="%s"/>' % " ".join("%.1f,%.1f" % p for p in lamina))
        partes.append('<polygon points="%s"/>' % " ".join("%.1f,%.1f" % p for p in haste))
        partes.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="#fff" stroke-width="%.1f"/>'
                      % (cx, cy, (re + ri) / 2, re - ri))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n'
        '<title>AUTOCORTES Z</title>\n<defs>\n'
        '<linearGradient id="fundo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f3a"/><stop offset="1" stop-color="#0c0e1c"/></linearGradient>\n'
        '<linearGradient id="fogo" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff3d00"/><stop offset="1" stop-color="#ff9100"/></linearGradient>\n'
        '<linearGradient id="brasa" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffab00"/><stop offset="1" stop-color="#ffec82"/></linearGradient>\n'
        '</defs>\n'
        '<rect width="512" height="512" rx="118" fill="url(#fundo)"/>\n'
        '<path d="%s" fill="url(#fogo)"/>\n<path d="%s" fill="url(#brasa)"/>\n'
        '<g fill="#fff">\n%s\n</g>\n'
        '<circle cx="%g" cy="%g" r="10" fill="#1b1f3a"/>\n</svg>\n'
        % (_svg_path(CHAMA_EXT), _svg_path(CHAMA_INT), "\n".join(partes), PIVO[0], PIVO[1]))


def _degrade_vertical(tam, topo, base, caixa):
    """Imagem tam x tam com degrade vertical topo->base ocupando a caixa (y0, y1)."""
    img = Image.new("RGB", (tam, tam))
    d = ImageDraw.Draw(img)
    y0, y1 = caixa
    for y in range(tam):
        t = min(1, max(0, (y - y0) / max(1, y1 - y0)))
        d.line([(0, y), (tam, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(topo, base)))
    return img


def icone(lado=1024):
    k = 4  # supersampling
    S = lado * k
    f = S / 512

    def sc(pts):
        return [(x * f, y * f) for x, y in pts]

    camada = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # fundo
    fundo = _degrade_vertical(S, FUNDO_TOPO, FUNDO_BASE, (0, S)).convert("RGBA")
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=round(118 * f), fill=255)
    camada.paste(fundo, (0, 0), m)

    def preencher(pts, topo, base):
        mm = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mm).polygon(sc(pts), fill=255)
        ys = [p[1] * f for p in pts]
        g = _degrade_vertical(S, topo, base, (min(ys), max(ys))).convert("RGBA")
        camada.paste(g, (0, 0), mm)

    preencher(_contorno(CHAMA_EXT), LARANJA_TOPO, LARANJA_BASE)
    preencher(_contorno(CHAMA_INT), AMARELO_TOPO, AMARELO_BASE)

    from PIL import ImageChops
    tesoura = Image.new("L", (S, S), 0)
    for sinal in (-1, 1):
        lamina, haste, (cx, cy), re, ri = _metade(sinal)
        m1 = Image.new("L", (S, S), 0)
        d1 = ImageDraw.Draw(m1)
        d1.polygon(sc(lamina), fill=255)
        d1.polygon(sc(haste), fill=255)
        d1.ellipse(((cx - re) * f, (cy - re) * f, (cx + re) * f, (cy + re) * f), fill=255)
        d1.ellipse(((cx - ri) * f, (cy - ri) * f, (cx + ri) * f, (cy + ri) * f), fill=0)
        tesoura = ImageChops.lighter(tesoura, m1)
    camada.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0), tesoura)
    d = ImageDraw.Draw(camada)
    d.ellipse(((PIVO[0] - 10) * f, (PIVO[1] - 10) * f, (PIVO[0] + 10) * f, (PIVO[1] + 10) * f), fill=FUNDO_TOPO + (255,))
    return camada.resize((lado, lado), Image.LANCZOS)


if __name__ == "__main__":
    os.makedirs(SAIDA, exist_ok=True)
    with open(os.path.join(SAIDA, "logo.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg())
    icone(512).save(os.path.join(SAIDA, "preview-512.png"))
    print("ok")
