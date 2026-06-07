// ==========================================
// AI 處方本質分析與教學推薦引擎 (獨立擴充模組)
// 負責：嚴謹等效劑量推導、結構啟發(加減法)演算法
// 注意：此模組依賴 app.js 提供的全域變數與共用函數
// ==========================================

function switchTab(tabName) {
    const tabStrict = document.getElementById('tabStrict');
    const tabStructure = document.getElementById('tabStructure');
    const strictPlansArea = document.getElementById('strictPlansArea');
    const structurePlansArea = document.getElementById('structurePlansArea');

    if(tabStrict) tabStrict.classList.remove('active');
    if(tabStructure) tabStructure.classList.remove('active');
    if(strictPlansArea) strictPlansArea.style.display = 'none';
    if(structurePlansArea) structurePlansArea.style.display = 'none';

    if(tabName === 'strict') {
        if(tabStrict) tabStrict.classList.add('active');
        if(strictPlansArea) strictPlansArea.style.display = 'block';
    } else {
        if(tabStructure) tabStructure.classList.add('active');
        if(structurePlansArea) structurePlansArea.style.display = 'block';
    }
}

function runEducationalAnalysis() {
    if (currentUIMode === 'learning') { 
        alert("請先切換至「臨床換算模式」再執行處方深度優化！"); 
        return;
    }
    if (prescription.filter(p => p.dose > 0).length === 0) {
        alert("⚠️ 請先輸入處方劑量！"); return;
    }

    let netTargets = {};
    let targetHerbNames = [];
    // globalFinalHerbs 來自 app.js 的計算結果
    for (let herb in globalFinalHerbs) {
        if (globalFinalHerbs[herb] > 0.01) { 
            netTargets[herb] = globalFinalHerbs[herb]; 
            targetHerbNames.push(herb);
        }
    }
    if (targetHerbNames.length === 0) return;

    // 🌟 AI 模擬分析基準：預設以港香蘭為推導主軸
    let targetSimulationBrand = "港香蘭"; 
    const checkedCategories = Array.from(document.querySelectorAll('.category-cb:checked')).map(cb => cb.value);
    
    // database 來自 app.js
    let validDB = database.filter(item => {
        if (!item.brand.includes(targetSimulationBrand) || item.isWarning || item.ratio <= 0) return false;
        if (!checkedCategories.includes(item.category)) return false; 
        return true;
    });

    if (validDB.length === 0) {
        const checkedBrands = Array.from(document.querySelectorAll('.brand-cb:checked')).map(cb => cb.value);
        validDB = database.filter(item => {
            if (!checkedBrands.includes(item.brand) || item.isWarning || item.ratio <= 0) return false;
            if (!checkedCategories.includes(item.category)) return false; 
            return true;
        });
    }

    let singleHerbs = validDB.filter(d => d.uniqueHerbCount === 1);
    let formulas = validDB.filter(d => d.uniqueHerbCount > 1);

    let singleLookup = {};
    singleHerbs.forEach(s => {
        if(s.herbArray.length > 0 && !singleLookup[s.herbArray[0]]) {
            singleLookup[s.herbArray[0]] = s;
        }
    });
    function getSingleHerbItem(herbName) { return singleLookup[herbName]; }

    generatedTeachingPlans = []; // 重置全域變數
    
    let allSinglesComb = [];
    let allSinglesMissing = []; 
    for (let herb in netTargets) {
        let sh = getSingleHerbItem(herb);
        if (!sh) { 
            allSinglesMissing.push(herb);
            continue; 
        }
        let coef = getHerbCoefficient(sh, herb); // 使用 app.js 的共用函數
        if(coef > 0) allSinglesComb.push({ item: sh, dose: parseFloat((netTargets[herb] / coef).toFixed(2)) });
    }
    
    let singlePlanTitle = "原形拆解 (全單方組合)";
    if (allSinglesMissing.length > 0) {
        singlePlanTitle = `原形拆解 (部分單方組合) <span style="color:#e67e22; font-size:11px;">⚠️ 無法補足: ${allSinglesMissing.join(',')}</span>`;
    }
    generatedTeachingPlans.push({ title: singlePlanTitle, isPureSingle: true, combination: allSinglesComb, score: -1 });

    formulas.forEach(formula => {
        let fHerbs = formula.herbArray; 
        let isSubset = true;
        for(let h of fHerbs) { if (!netTargets[h]) { isSubset = false; break; } }
        if (!isSubset) return; 

        let maxDose = Infinity;
        fHerbs.forEach(h => {
            let coef = getHerbCoefficient(formula, h);
            if (coef > 0) {
                let limit = netTargets[h] / coef;
                if (limit < maxDose) maxDose = limit;
            }
        });
        maxDose = Math.floor(maxDose * 10) / 10; 
        if (maxDose < 1.0) return; 

        let currentComb = [{ item: formula, dose: maxDose }];
        let formulaCoverage = 0;
        let strictMissingSingles = []; 

        for (let herb in netTargets) {
            let provided = getHerbCoefficient(formula, herb) * maxDose;
            let remainder = netTargets[herb] - provided;
            formulaCoverage += provided; 

            if (remainder > 0.05) { 
                let sh = getSingleHerbItem(herb);
                if (!sh) { 
                    strictMissingSingles.push(`${herb}(-${remainder.toFixed(1)}g)`);
                    continue; 
                }
                let shCoef = getHerbCoefficient(sh, herb);
                if (shCoef > 0) {
                    currentComb.push({ item: sh, dose: parseFloat((remainder / shCoef).toFixed(2)) });
                }
            }
        }

        // 使用 app.js 的 getCleanDisplayName
        let titleWithWarning = `正統方義：以【${getCleanDisplayName(formula.name)}】為主軸`;
        if (strictMissingSingles.length > 0) {
            titleWithWarning += ` <span style="color:#e65100; font-size:11px;">⚠️ 殘留缺口: ${strictMissingSingles.join(', ')}</span>`;
        }

        generatedTeachingPlans.push({ 
            title: titleWithWarning, 
            isPureSingle: false, 
            combination: currentComb, 
            score: formulaCoverage,
            herbIdentity: formula.herbArray.join(',') 
        });
    });

    generatedTeachingPlans.sort((a, b) => b.score - a.score);
    
    let finalDisplayPlans = [];
    let seenStrictIdentities = new Set();
    for (let plan of generatedTeachingPlans) {
        if (plan.isPureSingle) continue;
        if (!seenStrictIdentities.has(plan.herbIdentity)) {
            seenStrictIdentities.add(plan.herbIdentity);
            finalDisplayPlans.push(plan);
            if (finalDisplayPlans.length >= 4) break;
        }
    }

    let pureSinglePlan = generatedTeachingPlans.find(p => p.isPureSingle);
    if (pureSinglePlan) finalDisplayPlans.push(pureSinglePlan);

    const optList = document.getElementById('optimizedList');
    if(optList) optList.innerHTML = '';
    
    if (finalDisplayPlans.length === 0 || (finalDisplayPlans.length === 1 && finalDisplayPlans[0].isPureSingle && allSinglesComb.length === 0)) {
        let unsupportHerbs = [];
        for(let herb in netTargets) {
            if(!getSingleHerbItem(herb)) unsupportHerbs.push(herb);
        }
        let failDiagnostic = `❌ 找不到能夠完全對應原藥材的等效方案。<br><br>`;
        if (unsupportHerbs.length > 0) {
            failDiagnostic += `💡 <strong>診斷原因：</strong>目前處方包含無單味科中支援的成分：<span style="color:#d32f2f; font-weight:bold;">${unsupportHerbs.join(', ')}</span>。導致等效劑量矩陣無法閉合。請嘗試切換至「結構啟發」面板觀看骨架建議！`;
        } else {
            failDiagnostic += `💡 <strong>診斷原因：</strong>勾選的廠牌與劑型限制過窄，現有庫存無法覆蓋生藥種類。`;
        }
        if(optList) optList.innerHTML = `<p style="color:#d32f2f; line-height:1.6; font-size:14px;">${failDiagnostic}</p>`;
    } else {
        finalDisplayPlans.forEach((plan, index) => {
            let itemsHtml = '';
            plan.combination.forEach(c => {
                let tag = c.item.uniqueHerbCount === 1 ? '單方' : '複方';
                // 🆕 移除了 [廠牌] 的顯示，版面更簡潔
                itemsHtml += `
                    <div class="plan-item">
                        <div class="has-hover" onclick="toggleMobileCard(this)" style="display:inline-block;">
                            <span><strong>${c.item.name}</strong> <small>(${tag})</small></span>
                            ${getHoverCardHTML(c.item)}
                        </div>
                        <span><strong>${c.dose} g</strong></span>
                    </div>`;
            });

            // 🆕 移除了套用按鈕
            if(optList) optList.innerHTML += `
                <div class="plan-card">
                    <div class="plan-header">
                        <span class="plan-title">方案 ${index + 1}：${plan.title}</span>
                    </div>
                    <div>${itemsHtml}</div>
                </div>`;
        });
    }

    // ==========================================
    // 結構啟發 (加減法演算法)
    // ==========================================
    let structuralPlans = [];
    
    let unifiedCandidates = formulas.map(f => {
        let surplus = f.herbArray.filter(h => !targetHerbNames.includes(h));
        let matchCount = f.herbArray.filter(h => targetHerbNames.includes(h)).length;
        return { formula: f, surplus: surplus, matchCount: matchCount };
    }).filter(item => item.surplus.length <= 5 && item.matchCount >= 2); 

    unifiedCandidates.sort((a, b) => {
        let scoreA = a.matchCount - (a.surplus.length * 1.5);
        let scoreB = b.matchCount - (b.surplus.length * 1.5);
        return scoreB - scoreA;
    });
    
    let topCandidates = unifiedCandidates.slice(0, 60).map(item => item.formula); 

    function hasSillySwap(minusArray, missingArray) {
        for (let m of minusArray) {
            let coreM = getCoreHerbName(m); // 使用 app.js 的共用函數
            if(!coreM) continue;
            for (let ah of missingArray) {
                let coreAh = getCoreHerbName(ah);
                if(!coreAh) continue;
                if (coreM === coreAh) return true;
            }
        }
        return false;
    }

    // 單方劑骨架分析
    topCandidates.forEach(f1 => {
        let combinedHerbs = new Set(f1.herbArray);
        let surplus = [...combinedHerbs].filter(h => !targetHerbNames.includes(h));
        let missing = targetHerbNames.filter(h => !combinedHerbs.has(h));
        
        if (hasSillySwap(surplus, missing)) return; 

        if (surplus.length <= 5) {
            let singlesToUse = [];
            let missingSingles = []; 
            for(let h of missing) {
                let sh = getSingleHerbItem(h);
                if(!sh) { 
                    missingSingles.push(h); 
                } else {
                    singlesToUse.push(sh);
                }
            }
            structuralPlans.push({
                formulas: [f1], singles: singlesToUse, minusHerbs: surplus, missingSingles: missingSingles,
                totalItems: 1 + surplus.length + singlesToUse.length + missingSingles.length, 
                formulaHerbCount: combinedHerbs.size - surplus.length,
                isSubtraction: surplus.length > 0
            });
        }
    });

    // 雙方劑疊加分析
    for(let i=0; i<topCandidates.length; i++) {
        let f1 = topCandidates[i];
        for(let j=i+1; j<topCandidates.length; j++) {
            let f2 = topCandidates[j];
            
            if (getCleanDisplayName(f1.name) === getCleanDisplayName(f2.name)) continue;

            let combinedHerbs = new Set(f1.herbArray);
            for(let h of f2.herbArray) combinedHerbs.add(h);
            
            let surplus = [...combinedHerbs].filter(h => !targetHerbNames.includes(h));
            let missing = targetHerbNames.filter(h => !combinedHerbs.has(h));
            
            if (hasSillySwap(surplus, missing)) continue;

            if (surplus.length <= 5) {
                let singlesToUse = [];
                let missingSingles = [];
                for(let h of missing) {
                    let sh = getSingleHerbItem(h);
                    if(!sh) { 
                        missingSingles.push(h); 
                    } else {
                        singlesToUse.push(sh);
                    }
                }
                structuralPlans.push({
                    formulas: [f1, f2], singles: singlesToUse, minusHerbs: surplus, missingSingles: missingSingles,
                    totalItems: 2 + surplus.length + singlesToUse.length + missingSingles.length, 
                    formulaHerbCount: combinedHerbs.size - surplus.length,
                    isSubtraction: surplus.length > 0
                });
            }
        }
    }

    function getPlanAbsoluteSignature(plan) {
        let fSig = plan.formulas.map(f => f.herbArray.join(',')).sort().join(' + ');
        let mSig = plan.minusHerbs.sort().join(',');
        let sSig = plan.singles.map(s => s.herbArray[0]).sort().join(',');
        let msSig = plan.missingSingles.sort().join(','); 
        return fSig + " | " + mSig + " | " + sSig + " | " + msSig;
    }
    
    function getPlanFormulaConcepts(plan) {
        return plan.formulas.map(f => f.herbArray.join(','));
    }

    let deduplicatedPlans = [];
    let seenSignatures = new Set();
    for(let p of structuralPlans) {
        let sig = getPlanAbsoluteSignature(p);
        if(!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            deduplicatedPlans.push(p);
        }
    }

    const modeSelect = document.getElementById('analysisModeSelect');
    const currentMode = modeSelect ? modeSelect.value : 'compact';
    
    if (currentMode === 'compact') {
        deduplicatedPlans.sort((a, b) => {
            if(a.totalItems !== b.totalItems) return a.totalItems - b.totalItems;
            return b.formulaHerbCount - a.formulaHerbCount; 
        });
    } else {
        deduplicatedPlans.sort((a, b) => {
            let costA = (a.formulas.length > 1 ? 2 : 0) + (a.singles.length * 1.5) + (a.minusHerbs.length * 5) + (a.missingSingles.length * 10);
            let costB = (b.formulas.length > 1 ? 2 : 0) + (b.singles.length * 1.5) + (b.minusHerbs.length * 5) + (b.missingSingles.length * 10);
            
            if (Math.abs(costA - costB) < 2) return b.formulaHerbCount - a.formulaHerbCount;
            return costA - costB;
        });
    }

    let finalDiversePlans = [];
    let usedFormulaConcepts = new Set();
    let remainingPlans = [];

    for(let p of deduplicatedPlans) {
        let concepts = getPlanFormulaConcepts(p);
        let isCompletelyRedundant = concepts.every(c => usedFormulaConcepts.has(c));
        
        if(!isCompletelyRedundant) {
            finalDiversePlans.push(p);
            concepts.forEach(c => usedFormulaConcepts.add(c));
            if(finalDiversePlans.length >= 5) break;
        } else {
            remainingPlans.push(p); 
        }
    }

    if(finalDiversePlans.length < 5) {
        for(let p of remainingPlans) {
            finalDiversePlans.push(p);
            if(finalDiversePlans.length >= 5) break;
        }
    }

    const structList = document.getElementById('structuralList');
    if(structList) structList.innerHTML = '';
    
    if (finalDiversePlans.length === 0) {
        if(structList) structList.innerHTML = `<p style="color:#d32f2f;">無法生成結構啟發：查無合適的對應方劑。</p>`;
    } else {
        finalDiversePlans.forEach((plan, index) => {
            let tagsHtml = '';
            
            plan.formulas.forEach(f => {
                tagsHtml += `<div class="tag-formula has-hover" onclick="toggleMobileCard(this)">📦 ${getCleanDisplayName(f.name)}${getHoverCardHTML(f)}</div>`;
            });
            
            if (plan.minusHerbs.length > 0) {
                tagsHtml += `<span style="color:#ccc; line-height:28px;">-</span>`;
                plan.minusHerbs.forEach(mh => {
                    tagsHtml += `<div class="tag-minus">❌ 去 ${mh}</div>`;
                });
            }
            
            if (plan.singles.length > 0) {
                tagsHtml += `<span style="color:#ccc; line-height:28px;">+</span>`;
                plan.singles.forEach(s => {
                    tagsHtml += `<div class="tag-single has-hover" onclick="toggleMobileCard(this)">🌿 ${getCleanDisplayName(s.name)}${getHoverCardHTML(s)}</div>`;
                });
            }

            if (plan.missingSingles && plan.missingSingles.length > 0) {
                tagsHtml += `<span style="color:#ccc; line-height:28px;">+</span>`;
                plan.missingSingles.forEach(ms => {
                    tagsHtml += `<div class="tag-single" style="background:#fff3cd; color:#856404; border-color:#ffeeba; cursor:not-allowed;">⚠️ 缺 ${ms}</div>`;
                });
            }
            
            let headerText = plan.isSubtraction ? 
                `啟發思路 ${index + 1}：經典加減法 (概念步驟：${plan.totalItems})` : 
                `啟發思路 ${index + 1}：精簡疊加骨架 (共 ${plan.totalItems} 品項)`;

            if(structList) structList.innerHTML += `
                <div class="struct-card">
                    <div class="struct-header">${headerText}</div>
                    <div class="struct-tags">${tagsHtml}</div>
                </div>`;
        });
    }

    let activeTabId = document.querySelector('.tab-btn.active') ? document.querySelector('.tab-btn.active').id : 'tabStrict';
    let activeTab = activeTabId === 'tabStructure' ? 'structure' : 'strict';
    
    const analysisArea = document.getElementById('analysisResultArea');
    if(analysisArea) analysisArea.style.display = 'block';
    
    switchTab(activeTab); 
}
