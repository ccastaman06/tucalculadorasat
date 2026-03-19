// netlify/functions/banxico.js
// SF43718 = FIX / Pub. DOF (mismo dato, diferente fecha de referencia)
// SF60653 = Para Pagos
// Los fines de semana/festivos se generan manualmente con N/E en FIX y DOF,
// heredando el último valor conocido de Pagos.

const TOKEN  = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE   = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
const SERIES = 'SF60653,SF43718';

exports.handler = async () => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    try {
        function fmtISO(d)  { return d.toISOString().split('T')[0]; }
        function fmtDDMM(d) {
            const [y,m,dd] = fmtISO(d).split('-');
            return `${dd}/${m}/${y}`;
        }
        function parseDate(ddmmyyyy) {
            const [dd,mm,yyyy] = ddmmyyyy.split('/');
            return new Date(`${yyyy}-${mm}-${dd}`);
        }

        const hoy    = new Date();
        const inicio = new Date(hoy);
        inicio.setDate(inicio.getDate() - 20);

        const url = `${BASE}/series/${SERIES}/datos/${fmtISO(inicio)}/${fmtISO(hoy)}?token=${TOKEN}`;
        const res = await fetch(url, { headers: { 'Bmx-Token': TOKEN, 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`Banxico HTTP ${res.status}`);

        const json   = await res.json();
        const series = json?.bmx?.series ?? [];

        function parseSerie(idSerie) {
            const s     = series.find(s => s.idSerie === idSerie);
            const datos = s?.datos ?? [];
            return datos.slice().reverse().map(d => ({
                fecha: d.fecha ?? '',
                valor: (d.dato && d.dato !== 'N/E') ? parseFloat(d.dato) : null,
            }));
        }

        const fixData   = parseSerie('SF43718'); // más reciente primero
        const pagosData = parseSerie('SF60653');

        const fechaHoy = fmtDDMM(hoy);

        // ── Valores principales ───────────────────────────────────────────────
        const latestFix = fixData[0] ?? null;
        const latest = {
            fix:   latestFix?.fecha === fechaHoy ? latestFix : { fecha: fechaHoy, valor: null },
            dof:   latestFix,
            pagos: pagosData[0] ?? null,
        };

        // ── Historial: generar los últimos 7 días calendario desde hoy ────────
        // Para cada día buscamos en los datos de la API; si no existe = fin de semana/festivo
        const historial = [];
        let ultimoPagos = null;

        // Pre-cargar el último pagos conocido antes del rango visible
        // (para heredar correctamente el primer fin de semana)
        const todosPagos = [...pagosData]; // más reciente primero

        for (let i = 0; i < 7; i++) {
            const d = new Date(hoy);
            d.setDate(d.getDate() - i);
            const f = fmtDDMM(d);

            const fixVal   = fixData.find(x => x.fecha === f)?.valor   ?? null;
            const pagosObj = pagosData.find(x => x.fecha === f);
            const dofObj   = fixData.find(x => x.fecha === f); // DOF de esta fecha = FIX de este día

            // DOF de esta fecha = FIX del día anterior más cercano con dato
            // (porque Pub. DOF de hoy = FIX determinado ayer)
            const dOfVal = (() => {
                // buscar en fixData el primer registro con fecha < f
                const entry = fixData.find(x => parseDate(x.fecha) < parseDate(f) && x.valor !== null);
                return entry?.valor ?? null;
            })();

            // Para Pagos: valor directo o heredar último conocido
            let pagosVal = pagosObj?.valor ?? null;
            if (pagosVal !== null) ultimoPagos = pagosVal;
            else pagosVal = ultimoPagos ?? (todosPagos.find(x => parseDate(x.fecha) < parseDate(f) && x.valor !== null)?.valor ?? null);

            historial.push({
                fecha: f,
                fix:   fixVal,
                dof:   dOfVal,
                pagos: pagosVal,
            });
        }

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
