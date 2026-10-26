// Vercel Function: GET busca una inscripción y PUT cambia su estado.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

// estado nuevo -> estado desde el que se permite llegar
const PREVIO = { Atendida: "Inscrita", Activo: "Atendida" };
const CAMPOS = "id,nombre,colegio,correo,whatsapp,plan_interes,estado,creado_en";

function cabeceras() {
  const h = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (SUPABASE_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SUPABASE_KEY;
  return h;
}

// Devuelve el filtro de búsqueda o un texto de error
function filtro(correo, telefono) {
  if (correo && telefono) return { error: "Envía solo el correo o solo el teléfono, no ambos." };
  if (!correo && !telefono) return { error: "Envía el correo o el teléfono de la persona." };
  if (correo) {
    const c = String(correo).trim();
    if (!/^\S+@\S+\.\S+$/.test(c) || c.length > 120) return { error: "El correo no es válido." };
    // ilike sin distinguir mayúsculas, con los comodines escapados para que coincida exacto
    const exacto = c.replace(/[\\%_]/g, "\\$&");
    return { query: "correo=ilike." + encodeURIComponent(exacto) };
  }
  const t = String(telefono).replace(/\D/g, "");
  if (t.length < 7 || t.length > 15) return { error: "El teléfono debe tener entre 7 y 15 dígitos." };
  return { query: "whatsapp=eq." + encodeURIComponent(t) };
}

async function buscar(query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/interesados?${query}&select=${CAMPOS}&limit=5`, {
    headers: cabeceras(),
  });
  if (!r.ok) throw new Error("Supabase respondió " + r.status);
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!SUPABASE_URL || !SUPABASE_KEY || !ADMIN_KEY) {
    return res.status(500).json({ error: "El servidor no está configurado." });
  }
  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Método no permitido." });
  }
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({ error: "Clave de administración incorrecta." });
  }

  try {
    const datos = req.method === "GET" ? req.query : req.body || {};
    const f = filtro(datos.correo, datos.telefono);
    if (f.error) return res.status(400).json({ error: f.error });

    const filas = await buscar(f.query);
    if (filas.length === 0) {
      return res.status(404).json({ error: "No existe una inscripción con ese dato." });
    }
    if (filas.length > 1) {
      return res.status(409).json({
        error: `Hay ${filas.length} inscripciones con ese dato. No se actualizó ninguna. Usa el otro dato para identificar a la persona.`,
        coincidencias: filas.length,
      });
    }
    const antes = filas[0];

    if (req.method === "GET") return res.status(200).json({ inscripcion: antes });

    const estado = datos.estado;
    if (!PREVIO[estado]) {
      return res.status(400).json({ error: "El estado debe ser Atendida o Activo." });
    }
    if (antes.estado === estado) {
      return res.status(409).json({ error: `La inscripción ya está en estado ${estado}.` });
    }
    if (antes.estado !== PREVIO[estado]) {
      return res.status(409).json({
        error: `Solo se puede pasar a ${estado} desde ${PREVIO[estado]}. Estado actual: ${antes.estado}.`,
      });
    }

    // Se actualiza por id: solo esa fila
    const r = await fetch(`${SUPABASE_URL}/rest/v1/interesados?id=eq.${antes.id}&select=${CAMPOS}`, {
      method: "PATCH",
      headers: { ...cabeceras(), Prefer: "return=representation" },
      body: JSON.stringify({ estado }),
    });
    if (!r.ok) throw new Error("Supabase respondió " + r.status);
    const actualizadas = await r.json();
    if (actualizadas.length !== 1) throw new Error("La actualización no afectó exactamente una fila.");

    return res.status(200).json({ antes, despues: actualizadas[0] });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo completar la operación." });
  }
};