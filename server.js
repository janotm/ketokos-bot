const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// === BEÁLLÍTÁSOK ===
const TARGET_URL = 'https://ketokos.hu/phase-two/api/pool';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1538628476574105641/GrKKapRLHkvHE_GvPeZMgptA8LPtLLFqPqjNWYKzf5PAenTcu8l_kScRCMGtmGp-PcGR'; 
const DISCORD_NOTIFY_INTERVAL = 10 * 60 * 1000; // 10 percenként küld üzenetet

let historyData = [];
let latestData = { total: null, system_message: null, lastUpdated: null };

function findKeyInObject(obj, keyName) {
    if (!obj || typeof obj !== 'object') return null;
    if (keyName in obj && typeof obj[keyName] !== 'object') return obj[keyName];
    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const found = findKeyInObject(obj[key], keyName);
            if (found !== null) return found;
        }
    }
    return null;
}

async function sendDiscordNotification(hourlyRate, count) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('IDE_MÁSOLD')) return;
    if (latestData.total === null) return;

    const formattedTotal = new Intl.NumberFormat('hu-HU').format(latestData.total);
    const formattedRate = (hourlyRate >= 0 ? '+' : '') + new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 }).format(hourlyRate);

    const embed = {
        title: "📊 Két Okos - Élő Statisztika",
        color: 3447003,
        fields: [
            { name: "💰 Jelenlegi érték", value: `**${formattedTotal}**`, inline: false },
            { name: "📈 1 órás átlag növekedés", value: `${formattedRate} / óra (${count} mérésből)`, inline: true }
        ],
        footer: { text: `Utolsó frissítés: ${latestData.lastUpdated}` },
        timestamp: new Date().toISOString()
    };

    if (latestData.system_message) {
        embed.fields.push({ name: "⚠️ Rendszerüzenet", value: latestData.system_message, inline: false });
    }

    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (e) {
        console.error('Hiba:', e.message);
    }
}

async function fetchData() {
    try {
        const response = await fetch(TARGET_URL);
        if (!response.ok) return;

        const data = await response.json();
        const totalVal = findKeyInObject(data, 'total');
        const systemMsg = findKeyInObject(data, 'system_message');

        if (totalVal !== null) {
            const numericValue = Number(String(totalVal).replace(/[^0-9.]/g, ''));
            if (!isNaN(numericValue)) {
                const now = Date.now();
                latestData.total = numericValue;
                latestData.system_message = systemMsg;
                latestData.lastUpdated = new Date().toLocaleTimeString('hu-HU');

                if (historyData.length === 0 || historyData[historyData.length - 1].value !== numericValue) {
                    historyData.push({ timestamp: now, value: numericValue });
                }

                historyData = historyData.filter(d => d.timestamp >= now - (24 * 3600 * 1000));
            }
        }
    } catch (e) {}
}

function getMetrics() {
    const now = Date.now();
    const hourData = historyData.filter(d => d.timestamp >= now - 3600000);
    let hourlyRate = 0;
    if (hourData.length >= 2) {
        const oldest = hourData[0];
        const newest = hourData[hourData.length - 1];
        const timeDiffSec = (newest.timestamp - oldest.timestamp) / 1000;
        if (timeDiffSec > 0) {
            hourlyRate = ((newest.value - oldest.value) / timeDiffSec) * 3600;
        }
    }
    return { hourlyRate, count: hourData.length };
}

fetchData();
setInterval(fetchData, 10000);

setInterval(() => {
    const { hourlyRate, count } = getMetrics();
    sendDiscordNotification(hourlyRate, count);
}, DISCORD_NOTIFY_INTERVAL);

app.get('/', (req, res) => res.send('Két Okos Bot Működik!'));
app.listen(PORT, () => console.log(`Szerver fut a ${PORT} porton`));