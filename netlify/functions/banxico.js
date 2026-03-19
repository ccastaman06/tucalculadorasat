// netlify/functions/banxico.js
// SF43718 = FIX
// SF60653 = Publicación DOF
// Para Pagos = último valor de SF60653 con al menos 1 día hábil de retraso

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
        inicio.setDate(inicio.getDate() - 20); // 20 días para tener suficiente historial

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
            // Más reciente primero, conservamos N/E como null pero guardamos si existe el registro
            return datos.slice().reverse().map(d => ({
                fecha: d.fecha ?? '',
                valor: (d.dato && d.dato !== 'N/E') ? parseFloat(d.dato) : null,
            }));
        }

        const dofData = parseSerie('SF60653'); // más reciente primero
        const fixData = parseSerie('SF43718');

        // Hoy: Para Pagos = primer valor NO nulo de dofData que sea de fecha anterior a hoy
        const fechaHoy = fmtFecha(hoy).replace(/-/g, '/').split('/').reverse().join('/'); // DD/MM/YYYY
        
        // latest DOF = dofData[0] (hoy o último día hábil)
        // latest FIX = fixData[0]
        // Para Pagos = el registro de dofData inmediatamente anterior al más reciente
        //   (porque "Para Pagos hoy" = "Pub DOF publicado ayer")
        const latestDof   = dofData[0] ?? null;
        const latestFix   = fixData[0] ?? null;
        // Para pagos: primer valor con fecha DISTINTA al latestDof y con valor no nulo
        const latestPagos = dofData.find((d, i) => i > 0 && d.valor !== null) ?? dofData[1] ?? null;

        const latest = {
            dof:   latestDof,
            fix:   latestFix,
            pagos: latestPagos,
        };

        // ── Historial 7 filas ──────────────────────────────────────────────
        // Necesitamos todas las fechas del calendario (incluyendo fines de semana)
        // Para cada fecha: FIX y DOF pueden ser N/E, Para Pagos = último DOF conocido anterior

        // Fechas únicas con datos en alguna serie (días hábiles)
        const fechasHabiles = [...new Set([
            ...dofData.map(d => d.fecha),
            ...fixData.map(d => d.fecha),
        ])].slice(0, 7);

        // Para el historial, "Para Pagos" de cada fila = valor DOF del día hábil anterior
        const historial = fechasHabiles.map((f) => {
            const idxDof = dofData.findIndex(d => d.fecha === f);
            // Para Pagos = primer valor no nulo después de esta fecha en dofData (índice mayor = más antiguo)
            let pagosVal = null;
            for (let i = idxDof + 1; i < dofData.length; i++) {
                if (dofData[i].valor !== null) { pagosVal = dofData[i].valor; break; }
            }
            return {
                fecha: f,
                fix:   fixData.find(d => d.fecha === f)?.valor ?? null,
                dof:   dofData.find(d => d.fecha === f)?.valor ?? null,
                pagos: pagosVal,
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
