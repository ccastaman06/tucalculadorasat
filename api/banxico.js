
// api/banxico.js — Vercel Serverless Function
// SF43718 = FIX (fecha de determinación)
// SF60653 = Para Pagos (fecha de liquidación)
// Pub. DOF = SF43718 del día hábil anterior

const TOKEN  = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE   = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
const SERIES = 'SF60653,SF43718';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

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
        const apires = await fetch(url, { headers: { 'Bmx-Token': TOKEN, 'Accept': 'application/json' } });
        if (!apires.ok) throw new Error(`Banxico HTTP ${apires.status}`);

        const json   = await apires.json();
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

        // Días hábiles = fechas donde SF43718 tiene registro
        const diasHabiles = new Set(fixData.map(d => d.fecha));
        const fechaHoy    = fmtDDMM(hoy);

        // ── Valores principales ───────────────────────────────────────────────
        const latestFix = fixData[0] ?? null;
        const latest = {
            // FIX: solo si hoy es día hábil Y el dato más reciente es de HOY
            fix:   { fecha: fechaHoy, valor: latestFix?.fecha === fechaHoy ? latestFix.valor : null },
            // Pub. DOF: siempre el último FIX publicado (ayer o último día hábil)
            dof:   latestFix,
            // Para Pagos: último dato de SF60653
            pagos: pagosData[0] ?? null,
        };

        // ── Historial: 7 días calendario hacia atrás desde hoy ───────────────
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

            // DOF: solo en días hábiles = FIX del día hábil anterior
            let dofVal = null;
            if (esDiaHabil) {
                const entry = fixData.find(x => parseDate(x.fecha) < parseDate(f) && x.valor !== null);
                dofVal = entry?.valor ?? null;
            }

            // Para Pagos: valor directo o hereda el último conocido (fines de semana)
            const pagosObj = pagosData.find(x => x.fecha === f);
            if (pagosObj?.valor != null) {
                ultimoPagos = pagosObj.valor;
            } else if (ultimoPagos === null) {
                const ant = pagosData.find(x => parseDate(x.fecha) < parseDate(f) && x.valor !== null);
                if (ant) ultimoPagos = ant.valor;
            }

            historial.push({ fecha: f, fix: fixVal, dof: dofVal, pagos: ultimoPagos });
        }

        res.status(200).json({ ok: true, latest, historial });

    } catch (err) {
        console.error('Error Banxico:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
