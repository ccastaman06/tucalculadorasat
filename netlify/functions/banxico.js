// netlify/functions/banxico.js
// Lógica verificada contra tabla Banxico 19/03/2026:
//   SF43718 = FIX por fecha de determinación
//             → Pub. DOF hoy    = SF43718[0] (último FIX publicado)
//             → FIX hoy         = SF43718[0] solo si su fecha == hoy, si no = null
//   SF60653 = Para Pagos (fecha de liquidación)
//             → Para Pagos hoy  = SF60653[0]

const TOKEN  = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE   = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
const SERIES = 'SF60653,SF43718';

exports.handler = async () => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    };

    try {
        function fmtISO(d)  { return d.toISOString().split('T')[0]; }          // YYYY-MM-DD
        function fmtDDMM(d) {                                                   // DD/MM/YYYY
            const [y,m,dd] = fmtISO(d).split('-');
            return `${dd}/${m}/${y}`;
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
        const pagosData = parseSerie('SF60653'); // más reciente primero

        const fechaHoy = fmtDDMM(hoy); // DD/MM/YYYY de hoy

        // ── Valores de hoy ────────────────────────────────────────────────────
        // Pub. DOF = último valor de SF43718 (sea de ayer o del último día hábil)
        // FIX      = SF43718[0] solo si su fecha es exactamente hoy, si no → null
        // Para Pagos = SF60653[0]
        const latestFix43 = fixData[0] ?? null;

        const latest = {
            fix:   latestFix43?.fecha === fechaHoy ? latestFix43 : { fecha: fechaHoy, valor: null },
            dof:   latestFix43,                    // último FIX publicado = Pub. DOF hoy
            pagos: pagosData[0] ?? null,
        };

        // ── Historial ─────────────────────────────────────────────────────────
        // Construimos las últimas 7 fechas del calendario contando hacia atrás desde hoy
        // Para cada fecha:
        //   FIX   = SF43718 de esa fecha exacta (null si N/E o no existe)
        //   DOF   = SF43718 del día hábil ANTERIOR a esa fecha
        //   Pagos = SF60653 de esa fecha exacta; si no existe, heredar el último conocido

        // Todas las fechas con datos en alguna serie (días hábiles)
        const fechasHabiles = [...new Set([
            ...fixData.map(d => d.fecha),
            ...pagosData.map(d => d.fecha),
        ])];

        // Tomar las 7 más recientes
        const fechas7 = fechasHabiles.slice(0, 7);

        // Agregar hoy si no está (puede que FIX y DOF sean N/E pero Pagos tenga valor)
        if (!fechas7.includes(fechaHoy)) fechas7.unshift(fechaHoy);
        const fechasHistorial = fechas7.slice(0, 7);

        // Para heredar Pagos en fines de semana necesitamos el último valor conocido
        let ultimoPagos = null;
        // Recorremos de más antiguo a más reciente para construir el mapa de herencia
        const pagosMap = {};
        [...pagosData].reverse().forEach(d => {
            if (d.valor !== null) ultimoPagos = d.valor;
            pagosMap[d.fecha] = d.valor;
        });

        // Mapa de FIX por fecha
        const fixMap = {};
        fixData.forEach(d => { fixMap[d.fecha] = d.valor; });

        const historial = fechasHistorial.map((f, i) => {
            // DOF de esta fecha = FIX del día hábil anterior = siguiente elemento en fixData
            const idxFix = fixData.findIndex(d => d.fecha === f);
            const dofVal = idxFix >= 0 && idxFix + 1 < fixData.length
                ? fixData[idxFix + 1].valor
                : (i + 1 < fechasHistorial.length ? fixMap[fechasHistorial[i + 1]] ?? null : null);

            // Para Pagos: valor directo o heredado del último día hábil anterior
            let pagosVal = pagosMap[f] ?? null;
            if (pagosVal === null) {
                // buscar el último valor de pagos anterior a esta fecha
                const anterior = pagosData.find((d) => {
                    // comparar fechas DD/MM/YYYY como strings no funciona bien, convertir
                    const [dd1,mm1,yy1] = f.split('/');
                    const [dd2,mm2,yy2] = d.fecha.split('/');
                    return new Date(`${yy2}-${mm2}-${dd2}`) < new Date(`${yy1}-${mm1}-${dd1}`) && d.valor !== null;
                });
                pagosVal = anterior?.valor ?? null;
            }

            return {
                fecha: f,
                fix:   fixMap[f] ?? null,
                dof:   dofVal,
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
