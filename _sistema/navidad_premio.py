#!/usr/bin/env python3
"""🎄 NAVIDAD 2026 · cifra el código del premio secreto (temporal, quitar tras el 25/12).

    python3 _sistema/navidad_premio.py              pide el código y lo cifra (1 entre 5000 por clic)
    python3 _sistema/navidad_premio.py --uno-de 3000  otra probabilidad
    python3 _sistema/navidad_premio.py --quitar       elimina el premio (solo quedan los renos)

El código se escribe a ciegas (no se ve ni se guarda en ningún sitio) y se elige un boleto ganador
al azar entre N. En _sistema/includes/navidad.html solo queda el código cifrado con ese boleto:
en cada clic el navegador del visitante saca un boleto e intenta abrir la caja. El boleto ganador
no se guarda: ni el repositorio ni la web lo contienen.

Esquema: el mismo que los acertijos (cifrar() en ./web y recursos/js/acertijo.js).
"""
import argparse
import base64
import getpass
import hashlib
import hmac
import json
import re
import secrets
import sys
from pathlib import Path

ARCHIVO = Path(__file__).resolve().parent / "includes" / "navidad.html"
INICIO, FIN = "// premio:inicio", "// premio:fin"
ITERACIONES = 300_000      # coste por clic en el navegador (~0,1-0,3 s, en segundo plano)


def b64(datos):
    return base64.b64encode(datos).decode()


def derivar(boleto, sal):
    return hashlib.pbkdf2_hmac("sha256", boleto.encode(), sal, ITERACIONES, dklen=64)


def cifrar(codigo, boleto):
    sal = secrets.token_bytes(16)
    claro = codigo.encode()
    k = derivar(boleto, sal)
    flujo = b"".join(hmac.new(k[:32], i.to_bytes(4, "big"), "sha256").digest()
                     for i in range((len(claro) + 31) // 32))
    cifra = bytes(x ^ y for x, y in zip(claro, flujo))
    sello = hmac.new(k[32:], cifra, "sha256").digest()
    return {"iteraciones": ITERACIONES, "sal": b64(sal), "cifra": b64(cifra), "sello": b64(sello)}


def escribir(valor_js):
    texto = ARCHIVO.read_text(encoding="utf-8")
    patron = re.compile(re.escape(INICIO) + r"\n(\s*)var PREMIO = .*?;\n(\s*)" + re.escape(FIN), re.S)
    if not patron.search(texto):
        sys.exit(f"No encuentro las marcas del premio en {ARCHIVO}")
    texto = patron.sub(lambda m: f"{INICIO}\n{m.group(1)}var PREMIO = {valor_js};\n{m.group(2)}{FIN}", texto)
    ARCHIVO.write_text(texto, encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uno-de", type=int, default=5000, metavar="N",
                   help="probabilidad por clic: 1 entre N (por defecto 5000 = 0,02 %%)")
    p.add_argument("--quitar", action="store_true", help="elimina el premio")
    a = p.parse_args()

    if a.quitar:
        escribir("null")
        print("Premio eliminado: Papá Noel vuelve a decir solo «¡Volved!».")
        return

    if a.uno_de < 100:
        sys.exit("--uno-de debe ser al menos 100.")
    codigo = getpass.getpass("Código del premio (no se verá al escribir): ").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{3,19}", codigo):
        sys.exit("El código debe tener de 4 a 20 caracteres: letras, números y guiones (sin espacios).")
    if getpass.getpass("Repítelo: ").strip() != codigo:
        sys.exit("No coinciden; no se ha cambiado nada.")

    boleto = str(secrets.randbelow(a.uno_de))
    datos = cifrar(codigo, boleto)
    datos["boletos"] = a.uno_de

    # Comprobación: el boleto ganador abre la caja (y luego se olvida)
    k = derivar(boleto, base64.b64decode(datos["sal"]))
    assert hmac.compare_digest(hmac.new(k[32:], base64.b64decode(datos["cifra"]), "sha256").digest(),
                               base64.b64decode(datos["sello"]))
    del boleto, k, codigo

    escribir(json.dumps(datos, separators=(",", ":")))
    print(f"Listo: premio cifrado en {ARCHIVO.relative_to(Path.cwd()) if ARCHIVO.is_relative_to(Path.cwd()) else ARCHIVO}")
    print(f"Probabilidad por clic: 1 entre {a.uno_de} ({100 / a.uno_de:.3f} %).")
    print("Publica con ./web publicar. Para retirarlo: python3 _sistema/navidad_premio.py --quitar")


if __name__ == "__main__":
    main()
