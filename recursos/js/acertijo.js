// Acertijos de las aventuras secretas.
// La parte secreta (vídeo y crónica) llega cifrada con la respuesta: la cifra "./web acertijo".
// Aquí se intenta descifrar con lo que escribe quien visita; si la respuesta no es, no se descifra nada.
// Cifrado (el mismo que en ./web): PBKDF2-SHA256 deriva dos claves de la respuesta; con la primera,
// HMAC-SHA256 en modo contador genera el flujo que se mezcla (XOR) con el texto; con la segunda se
// sella la cifra para saber si la respuesta es correcta. Solo Web Crypto del navegador, sin librerías.

const INTENTOS_POR_PISTA = 3;          // cada 3 fallos se desvela la siguiente pista
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// "Mulhacén " → "mulhacen": sin tildes, mayúsculas, espacios ni signos (igual que normalizar() en ./web)
export function normalizar(texto) {
  return texto.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function claveHmac(bytes, uso) {
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [uso]);
}

// Devuelve el secreto ({video, html}) si la respuesta es correcta; si no, null
export async function descifrar(datos, respuesta) {
  const clave = normalizar(respuesta);
  if (!clave) return null;
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64(datos.sal), iterations: datos.iteraciones }, base, 512));
  const sello = await claveHmac(bits.slice(32), "verify");
  // Una caja por cada respuesta válida: la respuesta correcta abre la suya
  for (const caja of datos.cajas) {
    const cifra = b64(caja.cifra);
    if (!(await crypto.subtle.verify("HMAC", sello, b64(caja.sello), cifra))) continue;
    const flujo = await claveHmac(bits.slice(0, 32), "sign");
    const claro = new Uint8Array(cifra.length);
    for (let i = 0; i * 32 < cifra.length; i++) {
      const contador = new Uint8Array(4);
      new DataView(contador.buffer).setUint32(0, i);
      const bloque = new Uint8Array(await crypto.subtle.sign("HMAC", flujo, contador));
      for (let j = 0; j < 32 && i * 32 + j < cifra.length; j++) claro[i * 32 + j] = cifra[i * 32 + j] ^ bloque[j];
    }
    return JSON.parse(new TextDecoder().decode(claro));
  }
  return null;
}

// ---------------------------------------------------------------- página

function guardado(clave, valor) {
  try {
    if (valor === undefined) return localStorage.getItem(clave);
    localStorage.setItem(clave, valor);
  } catch { return null; }
}

function mostrarSecreto(secreto, destino) {
  let html = secreto.html || "";
  if (secreto.video) {
    // Mismo formato que el shortcode {{< video >}} de Quarto, en modo de privacidad mejorada
    html += `<div class="quarto-video ratio ratio-16x9"><iframe src="https://www.youtube-nocookie.com/embed/${secreto.video}"
      title="Vídeo de la aventura" frameborder="0" referrerpolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen></iframe></div>`;
  }
  destino.innerHTML = html;
  destino.hidden = false;
}

function montar() {
  const caja = document.querySelector(".acertijo");
  if (!caja) return;
  const fuente = document.getElementById("acertijo-datos");
  const datos = fuente ? JSON.parse(fuente.textContent) : null;
  // Sin "index.html": misma clave entre por donde entre; la lista de aventuras la lee para abrir el candado
  const memoria = `acertijo:${location.pathname.replace(/index\.html$/, "")}`;
  const pistas = [...caja.querySelectorAll(".pista")];
  pistas.forEach((p) => (p.hidden = true));

  caja.insertAdjacentHTML("afterbegin", '<p class="acertijo-titulo"><i class="bi bi-lock-fill"></i> Acertijo</p>');
  const form = document.createElement("form");
  form.className = "acertijo-form";
  form.innerHTML = `
    <label class="visually-hidden" for="acertijo-respuesta">Respuesta</label>
    <input id="acertijo-respuesta" class="form-control" autocomplete="off" spellcheck="false" placeholder="Tu respuesta">
    <button class="btn perfil-boton" type="submit"><i class="bi bi-unlock"></i> Comprobar</button>
    <p class="acertijo-aviso" role="status" aria-live="polite"></p>`;
  pistas.length ? pistas[0].before(form) : caja.append(form);
  const premio = document.createElement("div");
  premio.className = "acertijo-premio";
  premio.hidden = true;
  caja.after(premio);

  const [entrada, boton, aviso] = [form.elements[0], form.elements[1], form.querySelector(".acertijo-aviso")];
  if (!datos || !window.crypto?.subtle) {
    aviso.textContent = datos ? "Tu navegador no permite abrir el acertijo (necesita una conexión segura)."
                              : "Borrador: falta cifrar la parte secreta con ./web acertijo.";
    entrada.disabled = boton.disabled = true;
    return;
  }

  const resuelto = (secreto, respuesta) => {
    caja.classList.add("resuelta");
    caja.querySelector(".acertijo-titulo").innerHTML = '<i class="bi bi-unlock-fill"></i> Acertijo resuelto';
    form.remove();
    pistas.forEach((p) => (p.hidden = true));
    mostrarSecreto(secreto, premio);
    guardado(memoria, respuesta);
  };

  let fallos = 0;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!normalizar(entrada.value)) return;
    boton.disabled = true;
    aviso.textContent = "Comprobando…";
    const secreto = await descifrar(datos, entrada.value);
    boton.disabled = false;
    if (secreto) return resuelto(secreto, entrada.value);

    fallos++;
    aviso.textContent = "Esa no es. Inténtalo de nuevo.";
    const siguiente = pistas.find((p) => p.hidden);
    if (siguiente && fallos % INTENTOS_POR_PISTA === 0) {
      siguiente.hidden = false;
      aviso.textContent += " Te dejo una pista.";
    }
    caja.classList.remove("acertijo-fallo");
    void caja.offsetWidth;               // reinicia la animación del temblor
    caja.classList.add("acertijo-fallo");
    entrada.select();
  });

  // Si esta persona ya lo resolvió antes, se abre solo; si la respuesta cambió, se olvida la vieja
  // (así la lista de aventuras vuelve a mostrar el candado cerrado)
  const anterior = guardado(memoria);
  if (anterior) descifrar(datos, anterior).then((s) => {
    if (s) return resuelto(s, anterior);
    try { localStorage.removeItem(memoria); } catch {}
  });
}

if (typeof document !== "undefined") montar();
