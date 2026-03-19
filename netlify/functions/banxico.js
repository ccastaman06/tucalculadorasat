// netlify/functions/banxico.js
// Proxy seguro para la API de Banxico — evita CORS en el navegador.
// Se llama desde el frontend como: GET /.netlify/functions/banxico

const TOKEN  = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE   = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
// SF60653 = Publicación DOF  |  SF43718 = FIX  |  SF46410 = Para pagos (liquidación)
const SERIES = 'SF46410,SF60653,SF43718';

exports.handler = async () => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    try {
        const url = `${BASE}/series/${SERIES}/datos/oportuno?token=${TOKEN}`;
        const res = await fetch(url, {
            headers: { 'Bmx-Token': TOKEN, 'Accept': 'application/json' },
        });

        if (!res.ok) {
            throw new Error(`Banxico respondió con HTTP ${res.status}`);
        }

        const json = await res.json();
        const series = json?.bmx?.series ?? [];

        // Parsea cada serie en un objeto { valor, fecha }
        function parseSerie(idSerie) {
            const s = series.find(s => s.idSerie === idSerie);
            const datos = s?.datos ?? [];
            // Tomar los últimos 7 datos disponibles para el historial
            const recientes = datos.slice(-7).reverse();
            return recientes.map(d => ({
                fecha: d.fecha ?? '',
                valor: (d.dato && d.dato !== 'N/E') ? parseFloat(d.dato) : null,
            }));
        }

        const pagos = parseSerie('SF46410');
        const dof   = parseSerie('SF60653');
        const fix   = parseSerie('SF43718');

        // El "oportuno" de cada serie
        const latest = {
            pagos : pagos[0] ?? null,
            dof   : dof[0]   ?? null,
            fix   : fix[0]   ?? null,
        };

        // Construir historial fusionado por fecha (últimos 7 días únicos)
        const fechas = [...new Set([
            ...pagos.map(d => d.fecha),
            ...dof.map(d => d.fecha),
            ...fix.map(d => d.fecha),
        ])].slice(0, 7);

        const historial = fechas.map(f => ({
            fecha : f,
            pagos : pagos.find(d => d.fecha === f)?.valor ?? null,
            dof   : dof.find(d => d.fecha === f)?.valor   ?? null,
            fix   : fix.find(d => d.fecha === f)?.valor   ?? null,
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ ok: true, latest, historial }),
        };

    } catch (err) {
        console.error('Error consultando Banxico:', err.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ ok: false, error: err.message }),
        };
    }
};
