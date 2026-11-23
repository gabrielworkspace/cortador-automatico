# -*- coding: utf-8 -*-
"""
Gera o icone do AUTOCORTES Z (logo.py) em todos os tamanhos e as imagens do
instalador. Roda uma vez; os arquivos gerados ficam em instalador/imagens e o
montar.js so usa.

    python instalador/icone.py      (precisa do Pillow)
"""
import os
import shutil

from PIL import Image, ImageDraw, ImageFilter

import logo

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "imagens")
RAIZ = os.path.dirname(AQUI)
FUNDO_TOPO = (27, 31, 58)
FUNDO_BASE = (12, 14, 28)


def degrade(largura, altura):
    """Degrade vertical azul-noite, o mesmo fundo do icone."""
    img = Image.new("RGB", (largura, altura))
    d = ImageDraw.Draw(img)
    for y in range(altura):
        t = y / max(1, altura - 1)
        d.line([(0, y), (largura, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(FUNDO_TOPO, FUNDO_BASE)))
    return img


def lateral(largura, altura):
    """Imagem da esquerda nas telas de boas-vindas e de fim do instalador."""
    img = degrade(largura, altura).convert("RGBA")
    lado = round(largura * 0.72)
    ic = logo.icone(lado * 2).resize((lado, lado), Image.LANCZOS)
    caixa = ((largura - lado) // 2, round(altura * 0.34))
    brilho = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(brilho).ellipse(
        (caixa[0] - lado * 0.1, caixa[1] + lado * 0.1, caixa[0] + lado * 1.1, caixa[1] + lado * 1.15),
        fill=(255, 90, 0, 70))
    img = Image.alpha_composite(img, brilho.filter(ImageFilter.GaussianBlur(lado * 0.12)))
    img.alpha_composite(ic, caixa)
    return img.convert("RGB")


def main():
    os.makedirs(SAIDA, exist_ok=True)
    with open(os.path.join(SAIDA, "logo.svg"), "w", encoding="utf-8") as fh:
        fh.write(logo.svg())
    grande = logo.icone(1024)
    base = grande.resize((256, 256), Image.LANCZOS)
    base.save(os.path.join(SAIDA, "icone-256.png"))
    tamanhos = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    base.save(os.path.join(SAIDA, "icone.ico"), sizes=[(t, t) for t in tamanhos])
    # icone da janela do programa
    base.save(os.path.join(RAIZ, "src", "ui", "icone.png"))
    shutil.copyfile(os.path.join(SAIDA, "logo.svg"), os.path.join(RAIZ, "src", "ui", "logo.svg"))

    # Inno Setup escolhe a que melhor cabe na escala da tela (100%, 150%, 250%)
    for i, (w, h) in enumerate([(164, 314), (246, 459), (410, 797)]):
        lateral(w, h).save(os.path.join(SAIDA, "lateral-%d.bmp" % i))
    for i, t in enumerate([55, 83, 138]):
        img = Image.new("RGB", (t, t), (255, 255, 255))
        ic = grande.resize((round(t * 0.9), round(t * 0.9)), Image.LANCZOS)
        img.paste(ic, ((t - ic.width) // 2, (t - ic.height) // 2), ic)
        img.save(os.path.join(SAIDA, "pequena-%d.bmp" % i))
    print("imagens em", SAIDA)


if __name__ == "__main__":
    main()
