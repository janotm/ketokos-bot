const express = require('express');
const fetch = require('node-fetch');
const Diff = require('diff');

const app = express();
const PORT = process.env.PORT || 3000;

// === BEÁLLÍTÁSOK ===
const API_URL = 'https://ketokos.hu/phase-two/api/pool';
const PAGE_URL = 'https://ketokos.hu/phase-two/';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1538628476574105641/GrKKapRLHkvHE_GvPeZMgptA8LPtLLFqPqjNWYKzf5PAenTcu8l_kScRCMGtmGp-PcGR'; 
const TARGET_GOAL = 1000000000; // 1 000 000 000 cél

const STATS_INTERVAL = 1 * 60 * 1000; // Statisztika küldése: 1 PERCENKÉNT
const CHECK_INTERVAL = 10 * 1000;    // API és Oldal ellenőrzése: 10 másodpercenként

let historyData = [];
let latestData = { total: null, system_message: null, lastUpdated: null };
let lastPageHTML = null;

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

// Segédfüggvény a másodpercek formázásához (nap, óra, perc)
function formatDuration(remainingSec) {
    const days = Math.floor(remainingSec / 86400);
    const hours = Math.floor((remainingSec % 86400) / 3600);
    const minutes = Math.floor((remainingSec % 3600) / 60);

    let durationStr = "";
    if (days > 0) durationStr += `${days} nap `;
    if (hours > 0 || days > 0) durationStr += `${hours} óra `;
    durationStr += `${minutes} perc`;
    return durationStr;
}

// 1. Statisztika küldése Discordra (Percenként)
async function sendDiscordStats(metrics) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('IDE_MÁSOLD')) return;
    if (latestData.total === null) return;

    const formattedTotal = new Intl.NumberFormat('hu-HU').format(latestData.total);
    const formattedDiff = (metrics.diffSinceLast >= 0 ? '+' : '') + new Intl.NumberFormat('hu-HU').format(metrics.diffSinceLast);
    const formattedRate = (metrics.hourlyRate >= 0 ? '+' : '') + new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 }).format(metrics.hourlyRate);
    const formattedRemaining = new Intl.NumberFormat('hu-HU').format(metrics.remainingValue);

    const embed = {
        title: "📊 Két Okos - Élő Statisztika",
        color: 3447003,
        fields: [
            { name: "💰 Jelenlegi érték", value: `**${formattedTotal}**`, inline: false },
            { name: "➕ Változás az előző mérés óta", value: `**${formattedDiff}**`, inline: true },
            { name: "📈 1 órás átlag növekedés", value: `${formattedRate} / óra`, inline: true },
            { name: "🎯 Hátralévő összeg (1 milliárdig)", value: `**${formattedRemaining}**`, inline: false },
            { name: "⚡ Idő a JELENLEGI sebességgel (utolsó mérés)", value: `**${metrics.currentSpeedEta}**`, inline: false },
            { name: "⏱️ Idő az 1 ÓNAS ÁTLAG alapján (ETA)", value: `**${metrics.hourlyEtaText}**`, inline: false }
        ],
        footer: { text: `Utolsó frissítés: ${latestData.lastUpdated} (${metrics.count} mérésből)` },
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
        console.error('Hiba a statisztika küldésekor:', e.message);
    }
}

// 2. Kódváltozás értesítés küldése (@everyone)
async function sendCodeChangeAlert(changesText) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('IDE_MÁSOLD')) return;

    const truncatedDiff = changesText.length > 1800 ? changesText.substring(0, 1800) + '\n... (a többi változás levágva)' : changesText;

    const payload = {
        content: "@everyone ⚠️ **VÁLTOZÁS TÖRTÉNT A WEBOLDAL KÓDJÁBAN!**",
        embeds: [{
            title: "🔍 Kódváltozás részletei (ketokos.hu/phase-two/)",
            color: 15158332,
            description: "```diff\n" + truncatedDiff + "\n```",
            timestamp: new Date().toISOString()
        }]
    };

    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log("✅ Változás értesítés elküldve Discordra!");
    } catch (e) {
        console.error('Hiba a változás értesítő küldésekor:', e.message);
    }
}

// API adatgyűjtés
async function fetchData() {
    try {
        const response = await fetch(API_URL);
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

// HTML Forráskód ellenőrzése
async function checkPageChanges() {
    try {
        const response = await fetch(PAGE_URL);
        if (!response.ok) return;

        const currentHTML = await response.text();

        if (lastPageHTML === null) {
            lastPageHTML = currentHTML;
            console.log("Alapértelmezett HTML elmentve a figyeléshez.");
            return;
        }

        if (currentHTML !== lastPageHTML) {
            console.log("🚨 Változás észlelve a HTML kódban!");

            const diff = Diff.diffLines(lastPageHTML, currentHTML);
            let diffSummary = "";

            diff.forEach((part) => {
                if (part.added) {
                    diffSummary += `+ ${part.value.trim()}\n`;
                } else if (part.removed) {
                    diffSummary += `- ${part.value.trim()}\n`;
                }
            });

            if (diffSummary.trim().length > 0) {
                await sendCodeChangeAlert(diffSummary);
            }

            lastPageHTML = currentHTML;
        }
    } catch (e) {
        console.error("Hiba az oldal forráskódjának ellenőrzésekor:", e.message);
    }
}

// Metrikák és mindkét ETA kiszámítása
function getMetrics() {
    const now = Date.now();
    const hourData = historyData.filter(d => d.timestamp >= now - 3600000);
    
    let hourlyRate = 0;
    let diffSinceLast = 0;
    let timeDiffLastSec = 0;

    // Előző méréshez képesti különbség és időtartam
    if (historyData.length >= 2) {
        const currentObj = historyData[historyData.length - 1];
        const previousObj = historyData[historyData.length - 2];
        diffSinceLast = currentObj.value - previousObj.value;
        timeDiffLastSec = (currentObj.timestamp - previousObj.timestamp) / 1000;
    }

    // Órás átlag növekedés
    if (hourData.length >= 2) {
        const oldest = hourData[0];
        const newest = hourData[hourData.length - 1];
        const timeDiffSec = (newest.timestamp - oldest.timestamp) / 1000;
        if (timeDiffSec > 0) {
            hourlyRate = ((newest.value - oldest.value) / timeDiffSec) * 3600;
        }
    }

    const currentVal = latestData.total || 0;
    const remainingValue = Math.max(0, TARGET_GOAL - currentVal);
    
    let hourlyEtaText = "Számítás folyamatban...";
    let currentSpeedEta = "Számítás folyamatban...";

    if (currentVal >= TARGET_GOAL) {
        hourlyEtaText = "🎉 A cél teljesítve!";
        currentSpeedEta = "🎉 A cél teljesítve!";
    } else {
        // 1. ETA a JELENLEGI (utolsó mérés) növekedés alapján
        if (diffSinceLast <= 0 || timeDiffLastSec <= 0) {
            currentSpeedEta = "⚠️ Jelenleg nem növekszik (stagnál)";
        } else {
            const currentRatePerSec = diffSinceLast / timeDiffLastSec;
            const remainingSecCurrent = remainingValue / currentRatePerSec;
            currentSpeedEta = `~${formatDuration(remainingSecCurrent)} múlva`;
        }

        // 2. ETA az 1 ÓRÁS ÁTLAG alapján
        if (hourlyRate <= 0) {
            hourlyEtaText = "⚠️ Stagnál vagy csökken";
        } else {
            const hourlyRatePerSec = hourlyRate / 3600;
            const remainingSecHourly = remainingValue / hourlyRatePerSec;
            
            const etaDate = new Date(now + remainingSecHourly * 1000);
            const etaString = etaDate.toLocaleDateString('hu-HU', { 
                month: 'short', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            hourlyEtaText = `${etaString} (~${formatDuration(remainingSecHourly)} múlva)`;
        }
    }

    return { 
        hourlyRate, 
        count: hourData.length, 
        diffSinceLast, 
        remainingValue, 
        currentSpeedEta,
        hourlyEtaText 
    };
}

// 10 másodpercenkénti adategyeztetés
fetchData();
checkPageChanges();
setInterval(() => {
    fetchData();
    checkPageChanges();
}, CHECK_INTERVAL);

// Első küldés 15 másodperc múlva
setTimeout(() => {
    sendDiscordStats(getMetrics());
}, 15000);

// Statisztika küldése PERCENKÉNT
setInterval(() => {
    sendDiscordStats(getMetrics());
}, STATS_INTERVAL);

app.get('/', (req, res) => res.send('Két Okos Bot Működik!'));
app.listen(PORT, () => console.log(`Szerver fut a ${PORT} porton`));
