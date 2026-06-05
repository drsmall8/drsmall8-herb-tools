// ==========================================
// 讀取本地端 CSV 資料庫 (確保 database.csv 在同個資料夾)
// ==========================================
const googleSheetCsvUrl = "database.csv";

let database = []; 
let prescriptionClinical = []; 
let prescriptionLearning = []; 
let prescription = prescriptionClinical; 

let globalFinalHerbs = {}; 
let generatedTeachingPlans = []; 
let currentUIMode = 'clinical'; 

// 🌟 解決注音卡頓的狀態變數
let isComposing = false;
let searchDebounceTimer = null;

const herbDictionary = {
    "甘草(炙)": "炙甘草", "甘草（炙）": "炙甘草", "蜜甘草": "炙甘草", "炙草": "炙甘草",
    "乾薑": "乾薑", "薑(炮)": "炮薑", "炮薑": "炮薑",
    "半夏(薑製)": "薑半夏", "半夏": "薑半夏", "製半夏": "薑半夏",
    "大黃(酒製)": "大黃", "大黃(酒炒)": "大黃",
    "苦蔘": "苦參", "苦蔘根": "苦參", "苦參根": "苦參",
    "忍冬花": "金銀花", "銀花": "金銀花", "金銀花": "金銀花",
    "山梔子": "梔子", "紫蘇": "紫蘇葉", "乾生薑": "乾薑",
    "天花粉": "栝樓根(天花粉)", "栝樓根": "栝樓根(天花粉)",
    "蘆根": "葦根", "芍藥": "白芍", "大棗": "紅棗"
};

const toxicAlerts = {
    "附子": { max: 15.0 }, "炮附子": { max: 15.0 },
    "麻黃": { max: 10.0 }, "細辛": { max: 3.0 },
    "半夏": { max: 9.0 }, "薑半夏": { max: 9.0 }, "大黃": { max: 15.0 }
};

const animalKeywords = ['龍骨', '牡蠣', '阿膠', '殭蠶', '蟬蛻', '龜板', '龜膠', '鹿角', '鹿膠', '蠍', '螵蛸', '雞子黃', '內金', '豬膽', '蛤蚧', '石決明', '蜈蚣', '地龍', '水蛭', '土鱉', '虻蟲', '斑蝥', '鱉甲', '穿山甲', '水牛角', '玳瑁', '海馬', '牛黃', '麝香', '靈脂', '夜明砂', '望月砂', '蠶砂', '紫河車'];

const eighteenIncompatibilities = [
    { base: ["甘草", "炙甘草"], against: ["甘遂", "大戟", "海藻", "芫花"] },
    { base: ["川烏", "草烏", "附子", "炮附子"], against: ["半夏", "薑半夏", "栝樓根(天花粉)", "栝樓實", "貝母", "川貝母", "浙貝母", "白蘞", "白及"] },
    { base: ["藜蘆"], against: ["人參", "黨參", "沙參", "丹參", "玄參", "細辛", "芍藥", "白芍", "赤芍", "苦參"] }
];

const g6pdAlerts = ["黃連", "冰片", "珍珠粉", "牛黃", "金銀花", "牡丹皮", "生地黃", "柴胡", "大黃", "虎杖", "番瀉葉"];
const dopingAlerts = ["麻黃", "蓮子心", "丁香", "附子", "炮附子", "吳茱萸", "南天星", "枳實", "枳殼", "細辛", "蒼耳子", "辛夷"];

function isAnimalHerb(herbName) { return animalKeywords.some(kw => herbName.includes(kw)); }
function normalizeHerbName(name) {
    const cleanName = name.trim();
    if (cleanName === "牛膝") return "牛膝(需確認川/懷)";
    if (cleanName === "薑" || cleanName === "姜") return "薑(需確認生/乾)";
    return herbDictionary[cleanName] || cleanName;
}

function parseHerbString(str) {
    let obj = {}; let total = 0;
    if (str) {
        str.split('|').forEach(pair => {
            const kv = pair.split(':');
            if (kv.length === 2) {
                const name = normalizeHerbName(kv[0]);
                const w = parseFloat(kv[1]) || 0;
                obj[name] = (obj[name] || 0) + w;
                total += w;
            }
        });
    }
    return { obj, total, displayStr: str.replace(/\|/g, ', ') || '無' };
}

function getHoverCardHTML(d) {
    return `
        <div class="hover-card" onclick="event.stopPropagation();">
            <div class="hover-card-title">🔍 楚河漢界解析詳情</div>
            <p><strong>許可證：</strong>${d.license}</p>
            <p><strong>濃縮倍數：</strong><span style="color:#e67e22; font-weight:bold;">${d.ratio > 0 ? d.ratio : '⚠️ 缺資料'}</span></p>
            <p><strong>濃縮生藥：</strong><span style="color:#27ae60;">${d.concDisplay}</span></p>
            <p><strong>原粉生藥：</strong><span style="color:#8e44ad;">${d.rawDisplay}</span></p>
            <p><strong>賦形劑/添加物：</strong><span style="color:#7f8c8d;">${d.excDisplay}</span></p>
        </div>`;
}

function toggleMobileCard(element) {
    if(window.innerWidth <= 768) {
        const card = element.querySelector('.hover-card');
        const isDisplayed = card.style.display === 'block';
        document.querySelectorAll('.hover-card').forEach(c => c.style.display = 'none'); 
        card.style.display = isDisplayed ? 'none' : 'block';
    }
}

// 🌟 模式切換
function switchMainMode(mode) {
    currentUIMode = mode;
    
    const mainUI = document.getElementById('mainUIContainer');
    const statsUI = document.getElementById('statsUIContainer');
    const btnClin = document.getElementById('btnModeClinical');
    const btnLearn = document.getElementById('btnModeLearning');
    
    const clinBox = document.getElementById('clinicalResultBox');
    const learnBox = document.getElementById('learningRadarBox');
    const clinOpt = document.getElementById('clinicalAnalysisSection');
    const prescHint = document.getElementById('prescHint');
    const filterBrands = document.getElementById('filterBrandsBox');
    const filterCats = document.getElementById('filterCategoriesBox');
    const safetyBox = document.getElementById('safetyToggleBox');

    if (statsUI) statsUI.style.display = 'none';
    if (mainUI) mainUI.style.display = 'flex';

    if (mode === 'clinical') {
        prescription = prescriptionClinical; 
        if (btnClin) btnClin.classList.add('active-clinical');
        if (btnLearn) btnLearn.classList.remove('active-learning');
        
        if (clinBox) clinBox.style.display = 'block';
        if (learnBox) learnBox.style.display = 'none';
        if (clinOpt) clinOpt.style.display = 'block';
        if (prescHint) prescHint.style.display = 'none';
        
        if (filterBrands) filterBrands.style.display = 'block';
        if (filterCats) filterCats.style.display = 'block';
        if (safetyBox) safetyBox.style.display = 'block';
        
    } else if (mode === 'learning') {
        prescription = prescriptionLearning; 
        if (btnLearn) btnLearn.classList.add('active-learning');
        if (btnClin) btnClin.classList.remove('active-clinical');
        
        if (learnBox) learnBox.style.display = 'block';
        if (clinBox) clinBox.style.display = 'none';
        if (clinOpt) clinOpt.style.display = 'none';
        if (prescHint) prescHint.style.display = 'inline-block';
        
        if (filterBrands) filterBrands.style.display = 'none';
        if (filterCats) filterCats.style.display = 'none';
        if (safetyBox) safetyBox.style.display = 'none';

    } else if (mode === 'stats') {
        if (mainUI) mainUI.style.display = 'none';
        if (statsUI) statsUI.style.display = 'flex';
        if (btnClin) btnClin.classList.remove('active-clinical');
        if (btnLearn) btnLearn.classList.remove('active-learning');
        renderStats();
        return; 
    }
    
    filterDrugs(); 
    renderPrescription(); 
    calculateResult(); 
}

// 🌟 統計畫面
function renderStats() {
    let herbData = {}; 
    
    database.forEach(d => {
        if (d.uniqueHerbCount > 1 && !d.isWarning) {
            let formulaIdentity = `${getCleanDisplayName(d.name)}(${d.brand})`;
            
            d.herbArray.forEach(herb => {
                if (!herbData[herb]) {
                    herbData[herb] = { count: 0, sources: [] };
                }
                herbData[herb].count += 1;
                if (!herbData[herb].sources.includes(formulaIdentity)) {
                    herbData[herb].sources.push(formulaIdentity);
                }
            });
        }
    });

    let sortedHerbs = Object.keys(herbData).map(h => ({
        name: h,
        count: herbData[h].count,
        sources: herbData[h].sources
    }));
    sortedHerbs.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));

    const listDiv = document.getElementById('statsListArea');
    if (listDiv) {
        listDiv.innerHTML = sortedHerbs.map(h => {
            let displaySources = h.sources.slice(0, 2).join('、');
            if (h.sources.length > 2) displaySources += ' 等...';
            let sourcesHtml = `<div style="font-size:12px; color:#e74c3c; font-weight:normal; margin-top:5px; line-height:1.4;">📍 來源參考：${displaySources}</div>`;
            
            return `
                <div class="stat-item">
                    <div>
                        <span>🌿 ${h.name}</span>
                        ${sourcesHtml}
                    </div>
                    <span class="stat-count">${h.count} 個複方</span>
                </div>
            `;
        }).join('');
    }
}

// 🌟 載入資料庫
function loadCloudDatabase() {
    const statusMessage = document.getElementById('statusMessage');
    Papa.parse(googleSheetCsvUrl, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) {
            let brandCounts = {}; let categoryCounts = {}; 
            database = [];
            results.data.forEach((row, index) => {
                if (!row['顯示名稱']) return;
                const brand = row['藥廠'] || '未知藥廠';
                const category = row['分類標籤'] || '未知劑型';
                const ratio = parseFloat(row['濃縮倍數']) || 0;
                
                if(brand !== '其他藥廠' && brand !== '未知藥廠') brandCounts[brand] = (brandCounts[brand] || 0) + 1;
                categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                
                const conc = parseHerbString(row['濃縮生藥組成']);
                const raw = parseHerbString(row['原粉生藥組成']);
                const exc = parseHerbString(row['賦形劑組成']);
                
                let herbArr = Object.keys({...conc.obj, ...raw.obj}).sort(); 

                database.push({
                    id: index, license: row['許可證字號'] || '', brand: brand, name: row['顯示名稱'] || '',
                    category: category, ratio: ratio,
                    isWarning: (row['解析狀態'] || '').includes('⚠️'),
                    concHerbs: conc.obj, concTotalWeight: conc.total, concDisplay: conc.displayStr,
                    rawHerbs: raw.obj, rawTotalWeight: raw.total, rawDisplay: raw.displayStr,
                    excObj: exc.obj, excTotalWeight: exc.total, excDisplay: exc.displayStr,
                    herbArray: herbArr, uniqueHerbCount: herbArr.length, bopomofo: row['注音簡稱'] || ''
                });
            });
            
            populateBrandCheckboxes(brandCounts);
            populateCategoryCheckboxes(categoryCounts);
            if (statusMessage) {
                statusMessage.style.backgroundColor = "#d4edda"; 
                statusMessage.style.color = "#155724";
                statusMessage.innerHTML = `✅ 成功連線。載入 <strong>${database.length}</strong> 筆資料。`;
            }
            filterDrugs(); 
        },
        error: function(err) {
            if (statusMessage) {
                statusMessage.style.backgroundColor = "#f8d7da"; 
                statusMessage.style.color = "#721c24";
                statusMessage.innerHTML = `❌ 載入失敗。請確認 database.csv 是否存在！`;
            }
        }
    });
}

function populateBrandCheckboxes(counts) {
    const container = document.getElementById('brandCheckboxes');
    if(!container) return;
    container.innerHTML = '';
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(b => {
        container.innerHTML += `<label><input type="checkbox" value="${b}" class="brand-cb" onchange="filterDrugs()" checked> ${b} <span class="brand-count">(${counts[b]})</span></label>`;
    });
}

function populateCategoryCheckboxes(counts) {
    const container = document.getElementById('categoryCheckboxes');
    if(!container) return;
    container.innerHTML = '';
    const defaultChecked = ['濃縮散劑', '濃縮顆粒劑', '濃縮細粒劑', '散劑'];
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(c => {
        const isChecked = defaultChecked.includes(c) ? 'checked' : '';
        container.innerHTML += `<label><input type="checkbox" value="${c}" class="category-cb" onchange="filterDrugs()" ${isChecked}> ${c} <span class="brand-count">(${counts[c]})</span></label>`;
    });
}

function selectAllBrands(isSel) { document.querySelectorAll('.brand-cb').forEach(cb => cb.checked = isSel); filterDrugs(); }
function selectAllCategories(isSel) { document.querySelectorAll('.category-cb').forEach(cb => cb.checked = isSel); filterDrugs(); }

function renderDrugs(drugs) {
    const list = document.getElementById('drugList'); 
    if(!list) return;
    list.innerHTML = '';
    drugs.slice(0, 100).forEach(d => {
        const tag = d.uniqueHerbCount === 1 ? '<span style="color:#e67e22;">[單方]</span>' : '<span style="color:#2980b9;">[複方]</span>';
        list.innerHTML += `
            <li class="drug-item ${d.isWarning ? 'warning-bg' : ''}">
                <div class="drug-info-wrapper has-hover" onclick="toggleMobileCard(this)">
                    <span style="color:#888;font-size:12px;">[${d.brand}] [${d.category}] ${tag}</span><br>
                    <span class="${d.isWarning?'warning-text':''}" style="font-size:16px;"><strong>${d.name}</strong></span>
                    ${getHoverCardHTML(d)}
                </div>
                <button class="add-btn" onclick="addToPrescription(${d.id})">加入</button>
            </li>`;
    });
    if (drugs.length > 100) {
        list.innerHTML += `<li class="drug-item" style="color:#888; justify-content:center;">...還有 ${drugs.length - 100} 筆，請縮小搜尋範圍。</li>`;
    }
}

// 🌟 實際過濾邏輯
function actualFilterDrugs() {
    const searchInput = document.getElementById('searchInput');
    if(!searchInput) return;
    const keywords = searchInput.value.split(/[,，\s]+/).map(kw => kw.trim().toLowerCase()).filter(kw => kw.length > 0);
    
    let filteredData = database.filter(d => {
        if (currentUIMode === 'learning') {
            if (d.uniqueHerbCount > 1) return false; 
            if (!d.brand.includes("港香蘭") && !d.brand.includes("莊松榮")) return false; 
        } else {
            const checkedBrands = Array.from(document.querySelectorAll('.brand-cb:checked')).map(cb => cb.value);
            const checkedCategories = Array.from(document.querySelectorAll('.category-cb:checked')).map(cb => cb.value);
            if (!checkedBrands.includes(d.brand) || !checkedCategories.includes(d.category)) return false;
        }

        if (keywords.length === 0) return true;
        return keywords.some(kw => d.name.toLowerCase().includes(kw) || d.license.toLowerCase().includes(kw) || d.bopomofo.toLowerCase().includes(kw));
    });
    renderDrugs(filteredData);
}

// 🌟 防抖過濾器 (唯一版本)
function filterDrugs() {
    if (isComposing) return;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        actualFilterDrugs();
    }, 200); 
}

function addToPrescription(id) {
    if (!prescription.find(p => p.id === id)) { 
        prescription.push({ ...database.find(d => d.id === id), dose: 0 }); 
        renderPrescription(); calculateResult(); 
    }
}

function removePrescription(id) {
    if(currentUIMode === 'clinical') {
         prescriptionClinical = prescriptionClinical.filter(p => p.id !== id);
         prescription = prescriptionClinical;
    } else {
         prescriptionLearning = prescriptionLearning.filter(p => p.id !== id);
         prescription = prescriptionLearning;
    }
    renderPrescription(); calculateResult();
}

function updateDose(id, value) {
    const p = prescription.find(p => p.id === id);
    if (p) { p.dose = parseFloat(value) || 0; calculateResult(); }
}

function renderPrescription() {
    const list = document.getElementById('prescriptionList'); 
    if(!list) return;
    list.innerHTML = '';
    prescription.forEach(p => {
        list.innerHTML += `
            <div class="presc-item">
                <div class="presc-item-info has-hover" onclick="toggleMobileCard(this)">
                    <span style="font-size:15px; color:#666;">[${p.brand}] [${p.category}]</span><br>
                    <span><strong>${p.name}</strong></span>
                    ${getHoverCardHTML(p)}
                </div>
                <div class="presc-item-controls">
                    <input type="number" min="0" step="0.1" placeholder="克/日" value="${p.dose > 0 ? p.dose : ''}" 
                           onkeyup="updateDose(${p.id}, this.value)" onchange="updateDose(${p.id}, this.value)"> g
                    <button class="remove-btn" onclick="removePrescription(${p.id})">X</button>
                </div>
            </div>`;
    });
}

function getCleanDisplayName(name) { return name.replace(/[\(（].*?[\)）]/g, '').replace(/濃縮|顆粒|細粒|微粒|膠囊|錠劑|散劑|丸劑|浸膏|液/g, '').trim(); }
function getAbbrName(name) { let clean = getCleanDisplayName(name); return clean.length > 3 ? clean.substring(0, 3) : clean; }
function getCoreHerbName(name) { return name.replace(/炙|生|白|赤|乾|炮|製|藥|粉|炒|熟|川|懷/g, '').replace(/[\(（].*?[\)）]/g, '').trim(); }

function calculateResult() {
    let finalHerbs = {}; 
    let grandRaw = 0;
    let herbSources = {}; 
    let pureCompositionHerbs = new Set();

    prescription.forEach(p => {
        p.herbArray.forEach(h => pureCompositionHerbs.add(h)); 

        if (p.dose > 0 && !p.isWarning && p.ratio > 0) {
            let formulaTotalWeight = (p.concTotalWeight / (p.ratio || 1)) + p.rawTotalWeight + p.excTotalWeight || 0.0001; 
            for (let herb in p.concHerbs) {
                let actualWeight = (p.concHerbs[herb] / (p.concTotalWeight || 0.0001)) * (p.concTotalWeight / p.ratio);
                let rawEq = p.dose * (actualWeight / formulaTotalWeight) * p.ratio;
                finalHerbs[herb] = (finalHerbs[herb] || 0) + rawEq;
                grandRaw += rawEq;
                if (!herbSources[herb]) herbSources[herb] = new Set();
                herbSources[herb].add(p.name);
            }
            for (let herb in p.rawHerbs) {
                let rawEq = p.dose * (p.rawHerbs[herb] / formulaTotalWeight) * 1.0;
                finalHerbs[herb] = (finalHerbs[herb] || 0) + rawEq;
                grandRaw += rawEq;
                if (!herbSources[herb]) herbSources[herb] = new Set();
                herbSources[herb].add(p.name);
            }
        }
    });
    globalFinalHerbs = finalHerbs;
    
    if (currentUIMode === 'learning') {
        runAI_Radar(Array.from(pureCompositionHerbs), finalHerbs);
        return; 
    }

    const g6pdToggle = document.getElementById('g6pdToggle');
    const isG6pdChecked = g6pdToggle ? g6pdToggle.checked : false;
    
    const dopingToggle = document.getElementById('dopingToggle');
    const isDopingChecked = dopingToggle ? dopingToggle.checked : false;

    const list = document.getElementById('resultList'); 
    if(!list) return;
    list.innerHTML = '';
    
    Object.keys(finalHerbs).sort((a, b) => finalHerbs[b] - finalHerbs[a]).forEach(herb => {
        if(finalHerbs[herb] > 0.01){
            let alertHtml = '';
            let sourceNamesArray = Array.from(herbSources[herb] || []);
            let fullSourceNames = sourceNamesArray.map(name => getCleanDisplayName(name)).join('、');
            let abbrTags = sourceNamesArray.map(name => `<span class="source-abbr">${getAbbrName(name)}</span>`).join('');

            if (isAnimalHerb(herb)) alertHtml += `<span class="tag-animal">🍖 動物類</span>`;
            if (herb === "牛膝(需確認川/懷)" || herb === "薑(需確認生/乾)") alertHtml += `<span class="niuxi-alert">⚠️ 來自【${fullSourceNames}】，請確認</span>`;
            if(toxicAlerts[herb] && finalHerbs[herb] > toxicAlerts[herb].max) alertHtml += `<span class="toxic-alert">⚠️ 超量 (來自: ${fullSourceNames})</span>`;
            
            if (isG6pdChecked && g6pdAlerts.includes(herb)) alertHtml += `<span class="tag-g6pd">⚠️ 蠶豆症警示</span>`;
            if (isDopingChecked && dopingAlerts.includes(herb)) alertHtml += `<span class="tag-doping">🚫 運動禁藥</span>`;
            
            list.innerHTML += `
                <div class="result-item">
                    <div class="result-item-left">
                        ${herb} ${alertHtml}
                        <div>${abbrTags}</div>
                    </div>
                    <div class="result-item-right">${finalHerbs[herb].toFixed(2)} g</div>
                </div>`;
        }
    });
    
    const totalDisplay = document.getElementById('totalWeightDisplay');
    if(totalDisplay) totalDisplay.innerText = `總生藥重量: ${grandRaw.toFixed(2)} g`;

    let presentHerbs = Object.keys(finalHerbs).filter(h => finalHerbs[h] > 0.01);
    let alertMessages = [];
    eighteenIncompatibilities.forEach(rule => {
        let foundBases = presentHerbs.filter(h => rule.base.includes(h));
        let foundAgainst = presentHerbs.filter(h => rule.against.includes(h));
        if (foundBases.length > 0 && foundAgainst.length > 0) {
            alertMessages.push(`🚨 【十八反提示】處方中同時含有「${foundBases.join('、')}」與「${foundAgainst.join('、')}」，請確認！`);
        }
    });

    const alertBox = document.getElementById('incompatAlertBox');
    if(alertBox) {
        if (alertMessages.length > 0) {
            alertBox.innerHTML = alertMessages.join('<br>');
            alertBox.style.display = 'block';
        } else {
            alertBox.style.display = 'none';
        }
    }
}

function runAI_Radar(compositionArray, doseHerbsMap) {
    const targetDisplay = document.getElementById('radarTargetHerbs');
    const radarList = document.getElementById('radarResultsList');
    if(!targetDisplay || !radarList) return;
    
    radarList.innerHTML = '';

    if (compositionArray.length === 0) {
        targetDisplay.innerText = '無';
        radarList.innerHTML = '<p style="color:#888; text-align:center; padding: 20px;">請在左側搜尋並加入單方，<br>雷達將自動啟動掃描。</p>';
        return;
    }

    targetDisplay.innerText = compositionArray.join(', ');
    let hasDoses = Object.keys(doseHerbsMap).length > 0;
    
    let allFormulas = [];
    let seenNames = new Set();
    database.forEach(d => {
        let cleanN = getCleanDisplayName(d.name);
        if (d.uniqueHerbCount > 1 && !d.isWarning && !seenNames.has(cleanN)) {
            if (d.brand.includes("港香蘭") || d.brand.includes("莊松榮")) {
                seenNames.add(cleanN);
                allFormulas.push(d);
            }
        }
    });

    let results = allFormulas.map(f => {
        let match = f.herbArray.filter(h => compositionArray.includes(h));
        let surplus = f.herbArray.filter(h => !compositionArray.includes(h)); 
        let missing = compositionArray.filter(h => !f.herbArray.includes(h)); 

        let baseScore = match.length * 100;
        let ratioBonus = 0;
        let doseMsg = "";
        
        if (hasDoses && match.length >= 2) {
            let dotP = 0, normU = 0, normF = 0;
            match.forEach(h => {
                let userDose = doseHerbsMap[h] || 0;
                let formulaRatioWeight = getHerbCoefficient(f, h) * 10; 
                dotP += userDose * formulaRatioWeight;
                normU += userDose * userDose;
                normF += formulaRatioWeight * formulaRatioWeight;
            });
            if (normU > 0 && normF > 0) {
                let cosine = dotP / (Math.sqrt(normU) * Math.sqrt(normF));
                ratioBonus = cosine * 99; 
                doseMsg = `<span style="color:#d35400; font-size:13px; margin-left:10px; font-weight:bold;">⚖️ 比例相容度: ${(cosine*100).toFixed(1)}%</span>`;
            }
        }

        let penalty = surplus.length * 10;
        let finalScore = baseScore + ratioBonus - penalty;

        return { formula: f, match, surplus, missing, finalScore, doseMsg };
    }).filter(r => r.match.length >= 2); 

    results.sort((a,b) => b.finalScore - a.finalScore);
    let topResults = results.slice(0, 10);

    if (topResults.length === 0) {
        radarList.innerHTML = '<p style="color:#d32f2f;">無法推導：組合太過獨特，查無關聯經典方劑。</p>';
        return;
    }

    topResults.forEach((r, idx) => {
        let matchHtml = r.match.map(h => `<span class="tag-radar-match">${h}</span>`).join(' ');
        let surplusHtml = r.surplus.length > 0 ? `<div style="font-size:13px; color:#c0392b; margin-top:5px;"><strong>未涵蓋(減)：</strong> 去 ${r.surplus.join(', ')}</div>` : '';
        let missingHtml = r.missing.length > 0 ? `<div style="font-size:13px; color:#2980b9; margin-top:2px;"><strong>額外添(加)：</strong> 加 ${r.missing.join(', ')}</div>` : '';

        radarList.innerHTML += `
            <div class="radar-card">
                <div class="radar-title">
                    <span>🎯 #${idx+1}：${getCleanDisplayName(r.formula.name)} (${r.formula.brand})</span>
                    <span class="radar-score">${r.match.length} 味吻合</span>
                </div>
                <div style="font-size:13px; margin-bottom:5px;">${matchHtml} ${r.doseMsg}</div>
                ${surplusHtml}
                ${missingHtml}
            </div>
        `;
    });
}

function getHerbCoefficient(item, herbName) {
    let fw = (item.concTotalWeight / (item.ratio || 1)) + item.rawTotalWeight + item.excTotalWeight;
    if(fw <= 0) fw = 0.0001;
    let coef = 0;
    if (item.concHerbs && item.concHerbs[herbName]) {
        coef += ((item.concHerbs[herbName] / (item.concTotalWeight||0.0001)) * (item.concTotalWeight/item.ratio) / fw) * item.ratio;
    }
    if (item.rawHerbs && item.rawHerbs[herbName]) {
        coef += (item.rawHerbs[herbName] / fw) * 1.0;
    }
    return coef;
}

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
    for (let herb in globalFinalHerbs) {
        if (globalFinalHerbs[herb] > 0.01) { 
            netTargets[herb] = globalFinalHerbs[herb]; 
            targetHerbNames.push(herb);
        }
    }
    if (targetHerbNames.length === 0) return;

    const veganToggle = document.getElementById('veganModeToggle');
    const isVeganMode = veganToggle ? veganToggle.checked : false;
    if (isVeganMode) {
        let animalTargets = targetHerbNames.filter(h => isAnimalHerb(h));
        if (animalTargets.length > 0) {
            alert(`⚠️ 您開啟了「純素友善模式」，但當前處方中包含了動物類藥材（${animalTargets.join(', ')}）。\n\nAI 將自動為您排除這些成分，僅針對「植物性藥材」進行素食骨架的重組與推薦！`);
            targetHerbNames = targetHerbNames.filter(h => !isAnimalHerb(h));
            for(let h of animalTargets) delete netTargets[h];
        }
    }

    let targetSimulationBrand = "港香蘭"; 
    const checkedCategories = Array.from(document.querySelectorAll('.category-cb:checked')).map(cb => cb.value);
    
    let validDB = database.filter(item => {
        if (!item.brand.includes(targetSimulationBrand) || item.isWarning || item.ratio <= 0) return false;
        if (!checkedCategories.includes(item.category)) return false; 
        if (isVeganMode && item.herbArray.some(h => isAnimalHerb(h))) return false;
        return true;
    });

    if (validDB.length === 0) {
        const checkedBrands = Array.from(document.querySelectorAll('.brand-cb:checked')).map(cb => cb.value);
        validDB = database.filter(item => {
            if (!checkedBrands.includes(item.brand) || item.isWarning || item.ratio <= 0) return false;
            if (!checkedCategories.includes(item.category)) return false; 
            if (isVeganMode && item.herbArray.some(h => isAnimalHerb(h))) return false;
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

    generatedTeachingPlans = [];
    
    let allSinglesComb = [];
    let allSinglesMissing = []; 
    for (let herb in netTargets) {
        let sh = getSingleHerbItem(herb);
        if (!sh) { 
            allSinglesMissing.push(herb);
            continue; 
        }
        let coef = getHerbCoefficient(sh, herb);
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
            failDiagnostic += `💡 <strong>診斷原因：</strong>勾選的廠牌與劑型限制過窄或開啟了純素模式，現有庫存無法覆蓋生藥種類。`;
        }
        if(optList) optList.innerHTML = `<p style="color:#d32f2f; line-height:1.6; font-size:14px;">${failDiagnostic}</p>`;
    } else {
        finalDisplayPlans.forEach((plan, index) => {
            let itemsHtml = '';
            plan.combination.forEach(c => {
                let tag = c.item.uniqueHerbCount === 1 ? '單方' : '複方';
                itemsHtml += `
                    <div class="plan-item">
                        <div class="has-hover" onclick="toggleMobileCard(this)" style="display:inline-block;">
                            <span>[${c.item.brand}] <strong>${c.item.name}</strong> <small>(${tag})</small></span>
                            ${getHoverCardHTML(c.item)}
                        </div>
                        <span><strong>${c.dose} g</strong></span>
                    </div>`;
            });

            if(optList) optList.innerHTML += `
                <div class="plan-card">
                    <div class="plan-header">
                        <span class="plan-title">方案 ${index + 1}：${plan.title}</span>
                        <button class="apply-btn" onclick="applyPlan(${index})">套用此等效劑量</button>
                    </div>
                    <div>${itemsHtml}</div>
                </div>`;
        });
    }

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
            let coreM = getCoreHerbName(m);
            if(!coreM) continue;
            for (let ah of missingArray) {
                let coreAh = getCoreHerbName(ah);
                if(!coreAh) continue;
                if (coreM === coreAh) return true;
            }
        }
        return false;
    }

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

function applyPlan(index) {
    let plan = generatedTeachingPlans.filter(p => !p.isPureSingle).slice(0,4);
    let pureSinglePlan = generatedTeachingPlans.find(p => p.isPureSingle);
    if (pureSinglePlan) plan.push(pureSinglePlan);
    
    let selectedPlan = plan[index];
    if (!selectedPlan) return;

    prescription = [];
    selectedPlan.combination.forEach(c => {
        prescription.push({ ...c.item, dose: c.dose });
    });
    if (currentUIMode === 'clinical') prescriptionClinical = prescription;
    else prescriptionLearning = prescription;

    renderPrescription();
    calculateResult();
    
    const analysisArea = document.getElementById('analysisResultArea');
    if(analysisArea) analysisArea.style.display = 'none';
    
    alert("✅ 已成功替換為教學建議處方！");
}

// 🌟 初始化：確保畫面加載完畢再綁定事件
window.addEventListener('DOMContentLoaded', () => {
    loadCloudDatabase();
    
    // 綁定注音防抖事件
    const searchInputElem = document.getElementById('searchInput');
    if (searchInputElem) {
        searchInputElem.addEventListener('compositionstart', () => { isComposing = true; });
        searchInputElem.addEventListener('compositionend', () => { 
            isComposing = false; 
            filterDrugs(); 
        });
    }
});
