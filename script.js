// Constantes de configuración del comportamiento del chat
const LIMITE_CARACTERES = 500;
const PAUSA_MINIMA_MS = 1500;
const TIEMPO_LIMITE_MS = 30000;
const CLAVE_SESION = "agente_vaijes_session_id";

// Referencias a los elementos del DOM
const contenedorMensajes = document.getElementById("mensajes-chat");
const contenedorEstado = document.getElementById("estado-chat");
const formularioChat = document.getElementById("formulario-chat");
const entradaMensaje = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");

// Variables de control de sesión y estado de envío
let sessionIdMemoria = null;
let ultimoEnvioTimestamp = 0;
let envioEnCurso = false;

/**
 * Obtiene o genera un identificador único de sesión y lo persiste.
 */
function obtenerSessionId() {
  try {
    const guardado = localStorage.getItem(CLAVE_SESION);
    if (guardado) {
      return guardado;
    }
  } catch (error) {
    // Si localStorage está bloqueado, se continúa con memoria
  }

  if (sessionIdMemoria) {
    return sessionIdMemoria;
  }

  const nuevoId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `sesion-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  sessionIdMemoria = nuevoId;

  try {
    localStorage.setItem(CLAVE_SESION, nuevoId);
  } catch (error) {
    // Ignorar error si el almacenamiento local no está disponible
  }

  return nuevoId;
}

/**
 * Agrega una burbuja de texto sanitizada usando exclusivamente textContent.
 */
function agregarBurbuja(texto, tipo) {
  const burbuja = document.createElement("div");
  burbuja.classList.add("burbuja");

  if (tipo === "usuario") {
    burbuja.classList.add("burbuja-usuario");
  } else if (tipo === "error") {
    burbuja.classList.add("burbuja-error");
  } else {
    burbuja.classList.add("burbuja-agente");
  }

  burbuja.textContent = texto;
  contenedorMensajes.appendChild(burbuja);
  contenedorMensajes.scrollTop = contenedorMensajes.scrollHeight;
}

/**
 * Actualiza el indicador visual de estado debajo de los mensajes.
 */
function actualizarEstado(texto, esError = false) {
  contenedorEstado.textContent = texto;
  if (esError) {
    contenedorEstado.classList.add("error");
  } else {
    contenedorEstado.classList.remove("error");
  }
}

/**
 * Bloquea o habilita los controles de la zona de escritura.
 */
function alternarControles(deshabilitado) {
  entradaMensaje.disabled = deshabilitado;
  botonEnviar.disabled = deshabilitado;
}

/**
 * Verifica que la URL del webhook haya sido configurada en config.js.
 */
function webhookEstaConfigurado() {
  if (typeof WEBHOOK_URL !== "string") {
    return false;
  }
  const urlLimpia = WEBHOOK_URL.trim();
  return urlLimpia.length > 0 && !urlLimpia.includes("ACA VA");
}

/**
 * Extrae el texto válido de la respuesta recibida desde Make.
 */
function procesarRespuestaServidor(textoCrudo) {
  if (!textoCrudo || textoCrudo.trim().length === 0) {
    return "(respuesta vacía)";
  }

  try {
    const datos = JSON.parse(textoCrudo);
    if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
      const camposPrioritarios = ["response", "respuesta", "message", "mensaje"];
      for (const campo of camposPrioritarios) {
        if (typeof datos[campo] === "string" && datos[campo].trim().length > 0) {
          return datos[campo];
        }
      }
      return "Make respondió, pero sin el campo response";
    }
  } catch (error) {
    // Si no es JSON válido, se devuelve el texto recibido tal cual
  }

  return textoCrudo;
}

/**
 * Envía el mensaje al webhook de Make con control de tiempo límite y estados.
 */
async function enviarMensajeAlAgente(textoUsuario) {
  const ahora = Date.now();
  if (envioEnCurso || ahora - ultimoEnvioTimestamp < PAUSA_MINIMA_MS) {
    actualizarEstado("Esperá un instante antes de volver a enviar.");
    return;
  }

  if (!webhookEstaConfigurado()) {
    agregarBurbuja(textoUsuario, "usuario");
    agregarBurbuja("Falta pegar la URL de tu webhook en config.js", "error");
    return;
  }

  envioEnCurso = true;
  ultimoEnvioTimestamp = ahora;
  alternarControles(true);
  agregarBurbuja(textoUsuario, "usuario");
  actualizarEstado("Cargando recomendación...");

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);

  const cargaUtil = {
    sessionId: sessionIdActual,
    mensaje: textoUsuario,
    fecha: new Date().toISOString()
  };

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cargaUtil),
      signal: controlador.signal
    });

    const textoRespuesta = await respuesta.text();

    if (!respuesta.ok) {
      const mensajeHttp = `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`;
      agregarBurbuja(mensajeHttp, "error");
      actualizarEstado("Error en la respuesta del servidor.", true);
      return;
    }

    const textoFinal = procesarRespuestaServidor(textoRespuesta);
    agregarBurbuja(textoFinal, "agente");
    actualizarEstado("");
  } catch (error) {
    if (error.name === "AbortError") {
      agregarBurbuja("Tiempo agotado: el agente tardó más de 30 segundos en responder.", "error");
      actualizarEstado("Tiempo de espera agotado.", true);
    } else {
      agregarBurbuja("Error de red: no se pudo conectar con el servidor.", "error");
      actualizarEstado("Falla de conexión.", true);
    }
  } finally {
    clearTimeout(temporizador);
    envioEnCurso = false;
    alternarControles(false);
    entradaMensaje.focus();
  }
}

/**
 * Valida la entrada del usuario y dispara el envío al enviar el formulario.
 */
function manejarEnvioFormulario(evento) {
  evento.preventDefault();

  const texto = entradaMensaje.value.trim();
  if (!texto) {
    return;
  }

  if (texto.length > LIMITE_CARACTERES) {
    actualizarEstado(`El mensaje no puede superar los ${LIMITE_CARACTERES} caracteres.`, true);
    return;
  }

  entradaMensaje.value = "";
  enviarMensajeAlAgente(texto);
}

// Inicialización de la aplicación
const sessionIdActual = obtenerSessionId();
agregarBurbuja("¡Hola! Soy tu agente de vaijes. Contame qué destino o tipo de viaje tenés en mente.", "agente");
formularioChat.addEventListener("submit", manejarEnvioFormulario);
