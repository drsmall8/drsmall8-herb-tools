// ==========================================
// 擴充模組：AI 處方本質分析與教學推薦 (純淨金鑰去重 + 防鸚鵡學舌 + 動態碎方警告版)
// ==========================================

// 核心工具：產生「絕對純淨」的方劑金鑰，抹除所有廠牌與劑型干擾
function getPureFormulaKey(name) {
    let clean = getCleanDisplayName(name);
    let pure = clean.replace(/["'”’\s]|港香蘭|莊松榮|勝昌|順天堂|\(.*\)|（.*）/g, '');
    return pure.replace(/(湯|散|丸|膏|丹|粉|錠|膠囊|顆粒)(散|湯|丸|膏|丹|粉|錠|膠囊|顆粒)+$/, '$1');
}

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
            let dedupeKey = getPureFormulaKey(d.name);

            if (!seenNames.has(dedupeKey)) {
                seenNames.add(dedupeKey);
                d.dedupeKey = dedupeKey; 
                candidateDb.push(d);
            }
        }
    });

    if (complexFormulasInPresc.length === 1 && targetHerbs.length === complexFormulasInPresc[0].uniqueHerbCount) {
        runDeconstructionMode(complexFormulasInPresc[0], candidateDb, structArea, analysisMode);
    } else {
        runCombinationMode(targetHerbs, candidateDb, structArea, analysisMode);
    }

    runStrictEquivalenceMode(globalFinalHerbs, candidateDb, strictArea, complexFormulasInPresc);
    
    switchTab('structure');
}

// ==========================================
// 軌道二：嚴謹劑量等效 (動態碎方警告機制)
// ==========================================
function runStrictEquivalenceMode(targetHerbsMap, candidateDb, outputArea, originalComplexFormulas) {
    let targetHerbNames = Object.keys(targetHerbsMap).filter(h => targetHerbsMap[h] > 0.01);
    let allSolutions = [];
    let seenCombinationHashes = new Set(); 

    // 取得原處方的純淨指紋 (防鸚鵡學舌)
    let originalHash = originalComplexFormulas.map(p => getPureFormulaKey(p.name)).sort().join('+');

    // 尋找第一層基底複方
    let level1Solutions = [];
    candidateDb.forEach(f => {
        if (f.uniqueHerbCount < 2) return;
        
        let extraHerbs = f.herbArray.filter(h => !targetHerbNames.includes(h));
        // 微誤差容忍：允許替代方最多多出 2 味贅藥
        if (extraHerbs.length > 2) return; 

        let maxDose = Infinity;
        let cMap = {};
        f.herbArray.forEach(h => {
            let coef = getHerbCoefficient(f, h);
            cMap[h] = coef;
            if (coef > 0 && targetHerbsMap[h]) {
                maxDose = Math.min(maxDose, targetHerbsMap[h] / coef);
            }
        });

        maxDose = Math.min(maxDose, 15.0); 

        if (maxDose >= 0.5) {
            let coveredWeight = 0;
            let remainder = {};
            targetHerbNames.forEach(h => remainder[h] = targetHerbsMap[h]);

            f.herbArray.forEach(h => {
                if(cMap[h] && remainder[h]) {
                    let covered = maxDose * cMap[h];
                    coveredWeight += covered;
                    remainder[h] -= covered;
                }
            });

            level1Solutions.push({
                formulas: [{ name: getCleanDisplayName(f.name), dose: maxDose.toFixed(1), extra: extraHerbs, dedupeKey: f.dedupeKey }],
                coveredWeight: coveredWeight,
                remainder: remainder,
                totalExtraHerbs: [...extraHerbs]
            });
        }
    });

    level1Solutions.sort((a, b) => b.coveredWeight - a.coveredWeight);

    // 疊加第二層與第三層
    level1Solutions.slice(0, 10).forEach(sol1 => {
        let bestF2 = null, bestF2Dose = 0, bestF2Covered = 0, bestF2CMap = {}, bestF2Extra = [];

        candidateDb.forEach(f2 => {
            if (f2.dedupeKey === sol1.formulas[0].dedupeKey) return;
            if (f2.uniqueHerbCount < 2) return;
            
            let extraHerbs2 = f2.herbArray.filter(h => !targetHerbNames.includes(h));
            let combinedExtra = [...new Set([...sol1.totalExtraHerbs, ...extraHerbs2])];
            if (combinedExtra.length > 2) return;

            let maxDose2 = Infinity;
            let cMap2 = {};
            f2.herbArray.forEach(h => {
                let coef = getHerbCoefficient(f2, h);
                cMap2[h] = coef;
                if (coef > 0 && sol1.remainder[h]) {
                    maxDose2 = Math.min(maxDose2, sol1.remainder[h] / coef);
                }
            });

            maxDose2 = Math.min(maxDose2, 10.0);

            if (maxDose2 >= 0.5) {
                let covered2 = 0;
                f2.herbArray.forEach(h => { if(cMap2[h] && sol1.remainder[h]) covered2 += maxDose2 * cMap2[h]; });

                if (covered2 > bestF2Covered) {
                    bestF2Covered = covered2; bestF2 = f2; bestF2Dose = maxDose2; bestF2CMap = cMap2; bestF2Extra = extraHerbs2;
                }
            }
        });

        if (bestF2) {
            let newRemainder2 = { ...sol1.remainder };
            bestF2.herbArray.forEach(h => { if(bestF2CMap[h] && newRemainder2[h]) newRemainder2[h] -= bestF2Dose * bestF2CMap[h]; });
            
            let sol2 = {
                formulas: [...sol1.formulas, { name: getCleanDisplayName(bestF2.name), dose: bestF2Dose.toFixed(1), extra: bestF2Extra, dedupeKey: bestF2.dedupeKey }],
                coveredWeight: sol1.coveredWeight + bestF2Covered,
                remainder: newRemainder2,
                totalExtraHerbs: [...new Set([...sol1.totalExtraHerbs, ...bestF2Extra])]
            };
            
            // 嘗試疊加第三層
            let bestF3 = null, bestF3Dose = 0, bestF3Covered = 0, bestF3CMap = {}, bestF3Extra = [];
            candidateDb.forEach(f3 => {
                if (sol2.formulas.some(sf => sf.dedupeKey === f3.dedupeKey)) return;
                if (f3.uniqueHerbCount < 2) return;
                
                let extraHerbs3 = f3.herbArray.filter(h => !targetHerbNames.includes(h));
                let combinedExtra3 = [...new Set([...sol2.totalExtraHerbs, ...extraHerbs3])];
                if (combinedExtra3.length > 2) return;

                let maxDose3 = Infinity;
                let cMap3 = {};
                f3.herbArray.forEach(h => {
                    let coef = getHerbCoefficient(f3, h);
                    cMap3[h] = coef;
                    if (coef > 0 && sol2.remainder[h]) {
                        maxDose3 = Math.min(maxDose3, sol2.remainder[h] / coef);
                    }
                });

                maxDose3 = Math.min(maxDose3, 10.0);
                if (maxDose3 >= 0.5) {
                    let covered3 = 0;
                    f3.herbArray.forEach(h => { if(cMap3[h] && sol2.remainder[h]) covered3 += maxDose3 * cMap3[h]; });
                    if (covered3 > bestF3Covered) {
                        bestF3Covered = covered3; bestF3 = f3; bestF3Dose = maxDose3; bestF3CMap = cMap3; bestF3Extra = extraHerbs3;
                    }
                }
            });

            if(bestF3) {
                let newRemainder3 = { ...sol2.remainder };
                bestF3.herbArray.forEach(h => { if(bestF3CMap[h] && newRemainder3[h]) newRemainder3[h] -= bestF3Dose * bestF3CMap[h]; });
                allSolutions.push({
                    formulas: [...sol2.formulas, { name: getCleanDisplayName(bestF3.name), dose: bestF3Dose.toFixed(1), extra: bestF3Extra, dedupeKey: bestF3.dedupeKey }],
                    coveredWeight: sol2.coveredWeight + bestF3Covered,
                    remainder: newRemainder3,
                    totalExtraHerbs: [...new Set([...sol2.totalExtraHerbs, ...bestF3Extra])]
                });
            }
            allSolutions.push(sol2);
        }
        allSolutions.push(sol1);
    });

    let uniqueSolutions = [];
    allSolutions.sort((a, b) => b.coveredWeight - a.coveredWeight).forEach(sol => {
        let hash = sol.formulas.map(f => f.dedupeKey).sort().join('+');
        // 移除硬性淘汰規則，只過濾鸚鵡學舌與重複方案
        if (hash !== originalHash && !seenCombinationHashes.has(hash)) {
            seenCombinationHashes.add(hash);
            uniqueSolutions.push(sol);
        }
    });

    // 渲染 UI
    let strictHtml = `<div style="padding:15px; background:#f9f9f9; border-radius:6px; border:1px solid #e0e0e0;">
        <div style="font-weight:bold; color:#2c3e50; margin-bottom:10px; border-bottom:1px dashed #ccc; padding-bottom:6px;">⚖️ 彈性同效替換方案 (容忍微小誤差)</div>
        <p style="font-size:13px; color:#666; margin-bottom:12px;">系統為您尋找最高度重合的【複方基底】組合，並列出多出與缺少的單方，供您臨床裁量：</p>`;

    if(uniqueSolutions.length > 0) {
        uniqueSolutions.slice(0, 3).forEach((sol, idx) => {
            let missingHerbsArray = Object.keys(sol.remainder).filter(h => sol.remainder[h] > 0.1);
            let missingCount = missingHerbsArray.length;

            let fHtml = sol.formulas.map(f => `<span style="background:#5dade2; color:#fff; padding:3px 8px; border-radius:4px; font-weight:bold; margin-right:5px; display:inline-block; margin-bottom:4px;">📦 ${f.name} <span style="color:#ffeb3b;">${f.dose}g</span></span>`).join('');
            
            let missingHtml = missingHerbsArray
                .sort((a,b) => sol.remainder[b] - sol.remainder[a])
                .map(h => `<span style="display:inline-block; margin-right:10px; font-size:13px;">🌿 ${h} <span style="color:#d35400;">${sol.remainder[h].toFixed(1)}g</span></span>`)
                .join('');

            let extraHtml = sol.totalExtraHerbs.length > 0 
                ? `<div style="font-size:12px; color:#c0392b; margin-top:6px;">⚠️ <strong>此方案多出：</strong>${sol.totalExtraHerbs.join('、')}</div>` 
                : '';

            // 🆕 動態警告：超過 6 味亮紅燈
            let warningHtml = missingCount > 6 
                ? `<div style="font-size:12px; color:#e74c3c; font-weight:bold; margin-bottom:4px;">🚨 注意：此方案需補齊單方較多 (${missingCount} 味)，請斟酌調劑與吞服便利性。</div>`
                : `<div style="font-size:12px; color:#7f8c8d; margin-bottom:4px;">💡 <strong>缺少之藥味</strong> (可自行評估是否加單方)：</div>`;

            if(missingHtml === '') missingHtml = `<span style="color:#27ae60; font-weight:bold;">✅ 已完美等效！</span>`;

            strictHtml += `
            <div class="radar-card" style="margin-bottom:12px; padding:12px; background:#fff; border:1px solid #e0e0e0; border-radius:8px;">
                <div style="font-size:14px; color:#34495e; font-weight:bold; margin-bottom:8px;">💡 替代方案 ${idx+1}：</div>
                <div style="margin-bottom:4px;">${fHtml}</div>
                ${extraHtml}
                <div style="padding-top:8px; margin-top:6px; border-top:1px dashed #eee;">
                    ${missingCount > 0 ? warningHtml : ''}
                    ${missingHtml}
                </div>
            </div>`;
        });
    } else {
        strictHtml += `<p style="color:#e74c3c;">無法找到不重複的複方替代骨架，請參考下方全單方清單。</p>`;
    }

    let sortedHerbs = targetHerbNames.sort((a, b) => targetHerbsMap[b] - targetHerbsMap[a]);
    let allSingleHtml = sortedHerbs.map(h => `<span style="display:inline-block; background:#fff; border:1px solid #ccc; padding:4px 8px; border-radius:4px; font-size:13px; margin:4px 4px 0 0;">${h} <span style="color:#d35400; font-weight:bold;">${targetHerbsMap[h].toFixed(1)}g</span></span>`).join('');
    
    strictHtml += `
        <div style="margin-top:20px; border-top:1px solid #ddd; padding-top:15px;">
            <div style="font-weight:bold; color:#7f8c8d; font-size:13px; margin-bottom:8px;">📌 終極保底：全單方精確克數展開</div>
            <div>${allSingleHtml}</div>
        </div>
    </div>`;

    outputArea.innerHTML = strictHtml;
}

// ==========================================
// 軌道 B：方根拆解模式 (維持不動)
// ==========================================
function runDeconstructionMode(targetFormula, candidateDb, outputArea, mode) {
    let targetHerbs = targetFormula.herbArray;
    let targetCleanName = getCleanDisplayName(targetFormula.name);
    let subFormulas = [];
    let extraPenalty = (mode === 'elegant') ? 50 : 15;

    candidateDb.forEach(f => {
        if (f.dedupeKey === targetFormula.dedupeKey) return;
        if (f.uniqueHerbCount >= targetFormula.uniqueHerbCount) return;
        if (f.uniqueHerbCount < 2) return;

        let matchCount = 0;
        f.herbArray.forEach(h => { if (targetHerbs.includes(h)) matchCount++; });

        if (matchCount >= f.uniqueHerbCount * 0.8 && matchCount >= 2) {
            let missingFromTarget = targetHerbs.filter(h => !f.herbArray.includes(h)); 
            let extraInSub = f.herbArray.filter(h => !targetHerbs.includes(h)); 
            subFormulas.push({
                formula: f, matchCount: matchCount, missing: missingFromTarget, extra: extraInSub,
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
// 軌道 A：多方疊方優化模式 (維持不動)
// ==========================================
function runCombinationMode(targetHerbs, candidateDb, outputArea, mode) {
    let remainingHerbs = [...targetHerbs];
    let chosenFormulas = [];
    let extraPenalty = (mode === 'elegant') ? 30 : 10;

    while (remainingHerbs.length > 0 && chosenFormulas.length < 2) {
        let bestFormula = null, bestScore = -999;
        candidateDb.forEach(f => {
            let matchCount = 0;
            f.herbArray.forEach(h => { if (remainingHerbs.includes(h)) matchCount++; });
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
        chosenFormulas.forEach(f => { f.herbArray.forEach(h => { if (!targetHerbs.includes(h) && !extraHerbs.includes(h)) extraHerbs.push(h); }); });
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
