// ==========================================
// 擴充模組：AI 處方本質分析與教學推薦 (雙軌 + 動態模式升級版)
// ==========================================

function switchTab(tabId) {
    document.getElementById('tabStrict').classList.remove('active');
    document.getElementById('tabStructure').classList.remove('active');
    document.getElementById('strictPlansArea').style.display = 'none';
    document.getElementById('structurePlansArea').style.display = 'none';

    if (tabId === 'strict') {
        document.getElementById('tabStrict').classList.add('active');
        document.getElementById('strictPlansArea').style.display = 'block';
    } else {
        document.getElementById('tabStructure').classList.add('active');
        document.getElementById('structurePlansArea').style.display = 'block';
    }
}

function runEducationalAnalysis() {
    const strictArea = document.getElementById('optimizedList');
    const structArea = document.getElementById('structuralList');
    const resultSection = document.getElementById('analysisResultArea');
    
    // 🌟 讀取使用者的模式選擇 (compact 骨架精簡 / elegant 臨床優雅)
    const analysisMode = document.getElementById('analysisModeSelect') ? document.getElementById('analysisModeSelect').value : 'compact';

    if (!prescription || prescription.length === 0) {
        alert('請先在左側加入處方！');
        return;
    }

    resultSection.style.display = 'block';

    let targetHerbs = Object.keys(globalFinalHerbs).filter(h => globalFinalHerbs[h] > 0.01);
    let complexFormulasInPresc = prescription.filter(p => p.uniqueHerbCount > 1);

    // 限制候選庫：強制去重，且僅使用港香蘭
    let candidateDb = [];
    let seenNames = new Set();
    
    database.forEach(d => {
        if (d.uniqueHerbCount > 1 && !d.isWarning && d.brand.includes("港香蘭")) {
            let cleanName = getCleanDisplayName(d.name);
            if (!seenNames.has(cleanName)) {
                seenNames.add(cleanName);
                candidateDb.push(d);
            }
        }
    });

    // 雙軌制切換，並將 mode 傳遞進去
    if (complexFormulasInPresc.length === 1 && targetHerbs.length === complexFormulasInPresc[0].uniqueHerbCount) {
        runDeconstructionMode(complexFormulasInPresc[0], candidateDb, structArea, analysisMode);
    } else {
        runCombinationMode(targetHerbs, candidateDb, structArea, analysisMode);
    }

    strictArea.innerHTML = `<div style="padding:15px; color:#666; background:#f9f9f9; border-radius:6px;">
        <strong>⚖️ 嚴謹等效單方展開：</strong><br>
        如果您要完全用單方來調配此藥，請參考右側「原藥材換算結果」的精確克數直接開立單方。
    </div>`;
    
    switchTab('structure');
}

// ==========================================
// 軌道 B：方根拆解模式
// ==========================================
function runDeconstructionMode(targetFormula, candidateDb, outputArea, mode) {
    let targetHerbs = targetFormula.herbArray;
    let targetCleanName = getCleanDisplayName(targetFormula.name);
    let subFormulas = [];

    // 動態權重：優雅模式極度厭惡贅藥 (-50)，精簡模式容忍度較高 (-15)
    let extraPenalty = (mode === 'elegant') ? 50 : 15;

    candidateDb.forEach(f => {
        let fCleanName = getCleanDisplayName(f.name);
        
        if (fCleanName === targetCleanName) return;
        if (f.uniqueHerbCount >= targetFormula.uniqueHerbCount) return;
        if (f.uniqueHerbCount < 2) return;

        let matchCount = 0;
        f.herbArray.forEach(h => {
            if (targetHerbs.includes(h)) matchCount++;
        });

        if (matchCount >= f.uniqueHerbCount * 0.8 && matchCount >= 2) {
            let missingFromTarget = targetHerbs.filter(h => !f.herbArray.includes(h)); 
            let extraInSub = f.herbArray.filter(h => !targetHerbs.includes(h)); 

            subFormulas.push({
                formula: f,
                matchCount: matchCount,
                missing: missingFromTarget,
                extra: extraInSub,
                score: (matchCount * 10) - (extraInSub.length * extraPenalty) 
            });
        }
    });

    subFormulas = subFormulas.filter(res => res.score > 0).sort((a, b) => b.score - a.score);
    let topResults = subFormulas.slice(0, 5); 

    let modeText = (mode === 'elegant') ? '✨ 臨床優雅模式 (追求純淨基礎骨架)' : '📦 骨架精簡模式 (追求最大塊基底)';
    let html = `<div style="background:#e8f5e9; padding:12px; border-radius:6px; margin-bottom:15px; border:1px solid #c8e6c9; color:#2e7d32;">
        <strong>🔍 系統偵測為「單一複方」，啟動【方根拆解模式】</strong><br>
        <span style="font-size:12px; color:#555;">當前模式：${modeText}</span><br>
        目標：<span style="font-weight:bold; color:#1b5e20;">${targetCleanName}</span> (共 ${targetHerbs.length} 味)。以下為組成此方的演化思路：
    </div>`;

    if (topResults.length === 0) {
        html += `<p style="color:#e74c3c; padding:10px;">目前資料庫中未找到可完美對應的基礎小方骨架。</p>`;
    } else {
        topResults.forEach((res, index) => {
            let fName = getCleanDisplayName(res.formula.name);
            let addHtml = res.missing.length > 0 ? `<div style="color:#2980b9; margin-top:5px; font-size:13px;">➕ <strong>加：</strong>${res.missing.join('、')}</div>` : '';
            let removeHtml = res.extra.length > 0 ? `<div style="color:#c0392b; margin-top:3px; font-size:13px;">❌ <strong>去：</strong>${res.extra.join('、')}</div>` : '';

            html += `
            <div class="radar-card" style="margin-bottom:12px; padding:12px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                <div class="radar-title" style="color:#d35400; font-weight:bold; font-size:14px; border-bottom:1px dashed #fadbd8; padding-bottom:6px; margin-bottom:6px;">
                    💡 拆解思路 ${index + 1}：由【${fName}】擴充
                </div>
                <div style="font-size:14px; line-height:1.6;">
                    <span style="background:#f0b27a; color:#fff; padding:3px 8px; border-radius:4px; font-weight:bold;">📦 ${fName}</span>
                    ${addHtml}
                    ${removeHtml}
                </div>
            </div>`;
        });
    }
    outputArea.innerHTML = html;
}

// ==========================================
// 軌道 A：多方疊方優化模式
// ==========================================
function runCombinationMode(targetHerbs, candidateDb, outputArea, mode) {
    let remainingHerbs = [...targetHerbs];
    let chosenFormulas = [];
    let maxIterations = 2; 

    // 動態權重：優雅模式重罰贅藥 (-30)，精簡模式容忍涵蓋大方 (-10)
    let extraPenalty = (mode === 'elegant') ? 30 : 10;

    while (remainingHerbs.length > 0 && chosenFormulas.length < maxIterations) {
        let bestFormula = null;
        let bestMatchCount = 0;
        let bestScore = -999;

        candidateDb.forEach(f => {
            let matchCount = 0;
            f.herbArray.forEach(h => {
                if (remainingHerbs.includes(h)) matchCount++;
            });
            
            let extraCount = f.herbArray.filter(h => !targetHerbs.includes(h)).length;
            let score = (matchCount * 10) - (extraCount * extraPenalty); 

            if (score > bestScore && matchCount >= 3) { 
                bestScore = score;
                bestFormula = { formula: f, matchCount, extraCount, score };
            }
        });

        if (!bestFormula) break;

        chosenFormulas.push(bestFormula.formula);
        remainingHerbs = remainingHerbs.filter(h => !bestFormula.formula.herbArray.includes(h));
    }

    let modeText = (mode === 'elegant') ? '✨ 臨床優雅模式 (精準打擊，拒絕無用雜藥)' : '📦 骨架精簡模式 (追求品項最少化)';
    let html = `<div style="background:#e3f2fd; padding:12px; border-radius:6px; margin-bottom:15px; border:1px solid #bbdefb; color:#1565c0;">
        <strong>🧩 系統偵測為「疊方狀態」，啟動【疊方優化模式】</strong><br>
        <span style="font-size:12px; color:#555;">當前模式：${modeText}</span>
    </div>`;

    if (chosenFormulas.length > 0) {
        let fNames = chosenFormulas.map(f => `<span style="background:#5dade2; color:#fff; padding:3px 8px; border-radius:4px; margin-right:6px; font-weight:bold;">📦 ${getCleanDisplayName(f.name)}</span>`).join('');
        let missingHtml = remainingHerbs.length > 0 ? `<div style="margin-top:8px; color:#2980b9; font-size:13px;">➕ <strong>需額外加單方：</strong>${remainingHerbs.join('、')}</div>` : `<div style="margin-top:8px; color:#27ae60; font-weight:bold;">✅ 已完美涵蓋所有目標藥味</div>`;
        
        let extraHerbs = [];
        chosenFormulas.forEach(f => {
            f.herbArray.forEach(h => {
                if (!targetHerbs.includes(h) && !extraHerbs.includes(h)) extraHerbs.push(h);
            });
        });
        let extraHtml = extraHerbs.length > 0 ? `<div style="margin-top:4px; color:#c0392b; font-size:13px;">❌ <strong>多出且需注意之藥味：</strong>${extraHerbs.join('、')}</div>` : '';

        html += `
        <div class="radar-card" style="padding:12px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
            <div class="radar-title" style="color:#2c3e50; font-weight:bold; font-size:14px; border-bottom:1px dashed #bdc3c7; padding-bottom:6px; margin-bottom:6px;">
                💡 精簡骨架建議方案
            </div>
            <div style="font-size:14px; margin-top:8px;">
                <div style="margin-bottom:8px;">${fNames}</div>
                ${missingHtml}
                ${extraHtml}
            </div>
        </div>`;
    } else {
        html += `<p style="color:#e74c3c; padding:10px;">目前處方過於分散或特殊，無法推導出合適的大方骨架。</p>`;
    }
    outputArea.innerHTML = html;
}
