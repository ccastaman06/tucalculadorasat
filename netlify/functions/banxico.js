// netlify/functions/banxico.js
// Proxy seguro para la API de Banxico — evita CORS en el navegador.
// Mapeo correcto de series según tabla Banxico:
//   SF43718  = FIX (determinado hoy a las 12:00)
//   SF60653  = Publicación DOF (FIX de ayer publicado hoy)
//   SF46410  = Para Pagos (pub. DOF del día anterior, vigente hoy)

const TOKEN = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE  = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
const SERIES = 'SF46410,SF60653,SF43718';

exports.handler = async () => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    try {
        // /ultimos/10 para cubrir fines de semana y festivos y tener 7 días hábiles
        const url = `${BASE}/series/${SERIES}/datos/ultimos/10?token=${TOKEN}`;
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

        const pagosData = parseSerie('SF46410');
        const dofData   = parseSerie('SF60653');
        const fixData   = parseSerie('SF43718');

        const latest = {
            pagos: pagosData[0] ?? null,
            dof:   dofData[0]   ?? null,
            fix:   fixData[0]   ?? null,
        };

        // Historial: unión de fechas únicas, últimos 7 días hábiles
        const todasFechas = [...new Set([
            ...pagosData.map(d => d.fecha),
            ...dofData.map(d => d.fecha),
            ...fixData.map(d => d.fecha),
        ])].slice(0, 7);

        const historial = todasFechas.map(f => ({
            fecha: f,
            pagos: pagosData.find(d => d.fecha === f)?.valor ?? null,
            dof:   dofData.find(d => d.fecha === f)?.valor   ?? null,
            fix:   fixData.find(d => d.fecha === f)?.valor   ?? null,
        }));

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
