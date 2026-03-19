// netlify/functions/banxico.js
// Verificado contra tabla Banxico 19/03/2026:
//   SF43718 devuelve lo que Banxico llama "Publicación DOF"
//   SF60653 devuelve lo que Banxico llama "Para Pagos"
//   FIX real no está disponible via estas series — se muestra N/E cuando SF43718 no tiene dato del día

const TOKEN  = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE   = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
const SERIES = 'SF60653,SF43718';

exports.handler = async () => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    try {
        function fmtFecha(d) {
            return d.toISOString().split('T')[0];
        }
        const hoy    = new Date();
        const inicio = new Date(hoy);
        inicio.setDate(inicio.getDate() - 20);

        const url = `${BASE}/series/${SERIES}/datos/${fmtFecha(inicio)}/${fmtFecha(hoy)}?token=${TOKEN}`;
        const res = await fetch(url, {
            headers: { 'Bmx-Token': TOKEN, 'Accept': 'application/json' },
        });

        if (!res.ok) throw new Error(`Banxico HTTP ${res.status}`);

        const json = await res.json();
        const series = json?.bmx?.series ?? [];

        function parseSerie(idSerie) {
            const s = series.find(s => s.idSerie === idSerie);
            const datos = s?.datos ?? [];
            return datos.slice().reverse().map(d => ({
                fecha: d.fecha ?? '',
                valor: (d.dato && d.dato !== 'N/E') ? parseFloat(d.dato) : null,
            }));
        }

        // SF60653 = Para Pagos  |  SF43718 = Publicación DOF  |  FIX = mismo SF43718 del día anterior
        const pagosData = parseSerie('SF60653');
        const dofData   = parseSerie('SF43718');

        // FIX de hoy = SF43718 pero solo si tiene dato del día de HOY
        // Si el dato más reciente de SF43718 es de ayer o antes = N/E
        const fechaHoyStr = fmtFecha(hoy).split('-').reverse().join('/'); // DD/MM/YYYY
        const fixHoy = dofData[0]?.fecha === fechaHoyStr ? dofData[0] : { fecha: fechaHoyStr, valor: null };

        const latest = {
            pagos: pagosData[0] ?? null,   // Para Pagos
            dof:   dofData[0]   ?? null,   // Publicación DOF
            fix:   fixHoy,                 // FIX (N/E si no hay dato de hoy)
        };

        // Historial: fechas únicas de ambas series, últimas 7
        const todasFechas = [...new Set([
            ...pagosData.map(d => d.fecha),
            ...dofData.map(d => d.fecha),
        ])].slice(0, 7);

        const historial = todasFechas.map(f => {
            const esFechaHoy = f === fechaHoyStr;
            return {
                fecha: f,
                fix:   esFechaHoy
                    ? fixHoy.valor
                    : (dofData.find(d => d.fecha === f)?.valor ?? null),  // FIX histórico = SF43718
                dof:   dofData.find(d => d.fecha === f)?.valor   ?? null,
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
