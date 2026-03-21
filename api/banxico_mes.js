// api/banxico-mes.js — Vercel Serverless Function
// Devuelve todos los datos de un mes específico para el historial

const TOKEN = '95c2453758a4e2d0f27c683b13af9d6f14566452847d9477e11053142ff0e043';
const BASE  = 'https://www.banxico.org.mx/SieAPIRest/service/v1';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    try {
        // Get year and month from query params, default to current month
        function fechaMexico() {
            const now = new Date();
            return new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        }

        const hoyMx = fechaMexico();
        const year  = parseInt(req.query.year  ?? hoyMx.getFullYear());
        const month = parseInt(req.query.month ?? (hoyMx.getMonth() + 1));

        // First and last day of requested month
        const start = new Date(year, month - 1, 1);
        const end   = new Date(year, month, 0); // last day

        function fmtISO(d) { return d.toISOString().split('T')[0]; }
        function fmtDDMM(d) {
            const [y,m,dd] = fmtISO(d).split('-');
            return `${dd}/${m}/${y}`;
        }
        function parseDate(ddmmyyyy) {
            const [dd,mm,yyyy] = ddmmyyyy.split('/');
            return new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
        }

        const url = `${BASE}/series/SF60653,SF43718/datos/${fmtISO(start)}/${fmtISO(end)}?token=${TOKEN}`;
        const apires = await fetch(url, { headers: { 'Bmx-Token': TOKEN, 'Accept': 'application/json' } });
        if (!apires.ok) throw new Error(`Banxico HTTP ${apires.status}`);

        const json   = await apires.json();
        const series = json?.bmx?.series ?? [];

        function parseSerie(idSerie) {
            const s = series.find(s => s.idSerie === idSerie);
            const datos = s?.datos ?? [];
            const map = {};
            datos.forEach(d => {
                map[d.fecha] = (d.dato && d.dato !== 'N/E') ? parseFloat(d.dato) : null;
            });
            return map;
        }

        const fixMap   = parseSerie('SF43718');
        const pagosMap = parseSerie('SF60653');

        // Sorted fix dates for DOF calculation
        const fixDates = Object.keys(fixMap).sort((a, b) => parseDate(a) - parseDate(b));

        // Generate all calendar days of the month
        const days = [];
        const date = new Date(year, month - 1, 1);
        while (date.getMonth() === month - 1) {
            days.push(new Date(date));
            date.setDate(date.getDate() + 1);
        }

        // Cut off future days — only show up to today (Mexico time)
        const hoyISO = fmtISO(hoyMx);
        const daysFiltered = days.filter(d => fmtISO(d) <= hoyISO);

        let lastPagos = null;
        const rows = daysFiltered.map(d => {
            const f       = fmtDDMM(d);
            const dayOfWeek = d.getDay();
            const weekend = dayOfWeek === 0 || dayOfWeek === 6;

            // FIX: only on days SF43718 has a record
            const fixVal = fixMap.hasOwnProperty(f) ? fixMap[f] : null;

            // DOF: only on business days = last FIX with value before this date
            let dofVal = null;
            if (!weekend && fixMap.hasOwnProperty(f)) {
                const idx = fixDates.indexOf(f);
                for (let i = idx - 1; i >= 0; i--) {
                    if (fixMap[fixDates[i]] !== null) { dofVal = fixMap[fixDates[i]]; break; }
                }
            }

            // Para Pagos: direct or inherit last known
            const pagosVal = pagosMap[f] ?? null;
            if (pagosVal !== null) lastPagos = pagosVal;

            return {
                fecha:   f,
                weekend: weekend,
                fix:     fixVal,
                dof:     dofVal,
                pagos:   pagosVal ?? lastPagos,
            };
        });

        res.status(200).json({ ok: true, year, month, rows });

    } catch (err) {
        console.error('Error banxico-mes:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
