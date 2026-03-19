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
            return new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
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

        // Set de fechas hábiles según SF43718 (días donde Banxico publicó FIX)
        const diasHabiles = new Set(fixData.map(d => d.fecha));

        const fechaHoy = fmtDDMM(hoy);

        // ── Valores principales ───────────────────────────────────────────────
        const latestFix = fixData[0] ?? null;
        const latest = {
            // FIX hoy: solo si hoy es día hábil y tiene dato
            fix:   { fecha: fechaHoy, valor: latestFix?.fecha === fechaHoy ? latestFix.valor : null },
            // DOF hoy: siempre es el último FIX publicado (de ayer o último día hábil)
            dof:   latestFix,
            pagos: pagosData[0] ?? null,
        };

        // ── Historial: 7 días calendario hacia atrás ──────────────────────────
        const historial = [];
        let ultimoPagos = null;

        for (let i = 0; i < 7; i++) {
            const d = new Date(hoy);
            d.setDate(d.getDate() - i);
            const f = fmtDDMM(d);

            const esDiaHabil = diasHabiles.has(f);

            // FIX: solo en días hábiles
            const fixVal = esDiaHabil
                ? (fixData.find(x => x.fecha === f)?.valor ?? null)
                : null;

            // DOF: solo en días hábiles, y es el FIX del día hábil ANTERIOR
            let dofVal = null;
            if (esDiaHabil) {
                const entry = fixData.find(x => parseDate(x.fecha) < parseDate(f) && x.valor !== null);
                dofVal = entry?.valor ?? null;
            }

            // Pagos: valor directo si existe, si no hereda el último conocido
            const pagosObj = pagosData.find(x => x.fecha === f);
            if (pagosObj?.valor != null) ultimoPagos = pagosObj.valor;
            else if (ultimoPagos === null) {
                // buscar el más reciente anterior
                const ant = pagosData.find(x => parseDate(x.fecha) < parseDate(f) && x.valor !== null);
                if (ant) ultimoPagos = ant.valor;
            }

            historial.push({ fecha: f, fix: fixVal, dof: dofVal, pagos: ultimoPagos });
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
