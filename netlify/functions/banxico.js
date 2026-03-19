// netlify/functions/banxico.js
// Series correctas según tabla Banxico:
//   SF43718 = FIX (determinado hoy a las 12:00)
//   SF60653 = Publicación DOF (dato de hoy) / Para Pagos (dato de ayer)
// SF46410 descartada — contiene otro instrumento (no el tipo de cambio SAT)

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
        inicio.setDate(inicio.getDate() - 14);

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

        const dofData = parseSerie('SF60653');  // más reciente primero
        const fixData = parseSerie('SF43718');

        // Pub. DOF hoy  = dofData[0]
        // Para Pagos    = dofData[1] (el valor de ayer de SF60653)
        // FIX           = fixData[0]
        const latest = {
            dof:   dofData[0] ?? null,
            pagos: dofData[1] ?? null,
            fix:   fixData[0] ?? null,
        };

        // Historial: fechas únicas de ambas series, límite 7 filas
        const todasFechas = [...new Set([
            ...dofData.map(d => d.fecha),
            ...fixData.map(d => d.fecha),
        ])].slice(0, 7);

        // Para cada fecha del historial:
        // "Para Pagos" es el valor DOF del día ANTERIOR en el historial
        const historial = todasFechas.map((f, i) => {
            const dofHoy   = dofData.find(d => d.fecha === f)?.valor ?? null;
            const dofAyer  = dofData[dofData.findIndex(d => d.fecha === f) + 1]?.valor ?? null;
            const fixHoy   = fixData.find(d => d.fecha === f)?.valor ?? null;
            return {
                fecha: f,
                pagos: dofAyer,   // pub. DOF del día anterior
                dof:   dofHoy,    // pub. DOF de ese día
                fix:   fixHoy,    // FIX de ese día
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
