// netlify/functions/banxico.js
// Lógica verificada contra cuadro CF102 Banxico:
//   SF43718 = FIX (Fecha de determinación) — aparece el día que se determina
//   SF60653 = Para Pagos (Fecha de liquidación) — es el FIX de hace 2 días hábiles
//   Publicación DOF = SF43718 del día ANTERIOR (FIX de ayer publicado hoy en DOF)

const TOKEN  = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE   = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
const SERIES = 'SF60653,SF43718';

exports.handler = async () => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    try {
        function fmtISO(d) { return d.toISOString().split('T')[0]; }

        const hoy    = new Date();
        const inicio = new Date(hoy);
        inicio.setDate(inicio.getDate() - 20);

        const url = `${BASE}/series/${SERIES}/datos/${fmtISO(inicio)}/${fmtISO(hoy)}?token=${TOKEN}`;
        const res = await fetch(url, { headers: { 'Bmx-Token': TOKEN, 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`Banxico HTTP ${res.status}`);

        const json   = await res.json();
        const series = json?.bmx?.series ?? [];

        // Parsea una serie → array más reciente primero, preservando N/E como null
        function parseSerie(idSerie) {
            const s     = series.find(s => s.idSerie === idSerie);
            const datos = s?.datos ?? [];
            return datos.slice().reverse().map(d => ({
                fecha: d.fecha ?? '',
                valor: (d.dato && d.dato !== 'N/E') ? parseFloat(d.dato) : null,
            }));
        }

        const fixData   = parseSerie('SF43718'); // FIX — más reciente primero
        const pagosData = parseSerie('SF60653'); // Para Pagos — más reciente primero

        // ── Valores de HOY ────────────────────────────────────────────────────
        // FIX      = SF43718[0]  (puede ser null si aún no son las 12:00 o es inhábil)
        // Pub. DOF = SF43718[1]  (FIX de ayer, publicado hoy en el DOF)
        // Para Pagos = SF60653[0]

        const latest = {
            fix:   fixData[0]   ?? null,  // FIX de hoy
            dof:   fixData[1]   ?? null,  // Pub. DOF = FIX de ayer
            pagos: pagosData[0] ?? null,  // Para Pagos de hoy
        };

        // ── Historial 7 filas ─────────────────────────────────────────────────
        // Fechas únicas de ambas series (días con al menos un dato)
        const todasFechas = [...new Set([
            ...fixData.map(d => d.fecha),
            ...pagosData.map(d => d.fecha),
        ])].slice(0, 7);

        const historial = todasFechas.map(f => {
            const idxFix = fixData.findIndex(d => d.fecha === f);
            // Pub. DOF de esa fecha = FIX del día anterior en el array (índice + 1)
            const dofVal = idxFix >= 0 && idxFix + 1 < fixData.length
                ? fixData[idxFix + 1].valor
                : null;
            return {
                fecha: f,
                fix:   fixData.find(d => d.fecha === f)?.valor   ?? null,
                dof:   dofVal,
                pagos: pagosData.find(d => d.fecha === f)?.valor ?? null,
            };
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ ok: true, latest, historial }),
        };

    } catch (err) {
        console.error('Error Banxico:', err.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ ok: false, error: err.message }),
        };
    }
};
