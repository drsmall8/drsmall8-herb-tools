// ==========================================
// 讀取本地端 CSV 資料庫 (確保 database.csv 在同個資料夾)
// 核心大腦：負責系統初始化、資料過濾、臨床換算與防呆
// ==========================================
const googleSheetCsvUrl = "database.csv";

let database = []; 
let prescriptionClinical = []; 
let prescriptionLearning = []; 
let prescription = prescriptionClinical; 

let globalFinalHerbs = {}; 
let generatedTeachingPlans = []; 
let currentUIMode = 'clinical'; 

let isComposing = false;
let searchDebounceTimer = null;

let natureChartInstance = null;

const herbDictionary = {
    "甘草(炙)": "炙甘草", "甘草（炙）": "炙甘草", "蜜甘草": "炙甘草", "炙草": "炙甘草",
    "薑(炮)": "炮薑", "炮薑": "炮薑",
    "半夏(薑製)": "薑半夏", "半夏": "薑半夏", "製半夏": "薑半夏",
    "大黃(酒製)": "大黃", "大黃(酒炒)": "大黃",
    "苦蔘": "苦參", "苦蔘根": "苦參", "苦參根": "苦參",
    "忍冬花": "金銀花", "銀花": "金銀花", "金銀花": "金銀花",
    "山梔子": "梔子", "紫蘇": "紫蘇葉", 
    "天花粉": "栝樓根(天花粉)", "栝樓根": "栝樓根(天花粉)",
    "蘆根": "葦根", "芍藥": "白芍", "大棗": "紅棗",
    "薄荷葉": "薄荷",
    "生地黃": "生地"
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

const g6pdAlerts = ["黃連", "冰片", "珍珠粉", "牛黃", "金銀花", "牡丹皮", "生地黃", "生地", "柴胡", "大黃", "虎杖", "番瀉葉"];
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

    const sortSelect = document.getElementById('statsSortSelect');
    const sortMode = sortSelect ? sortSelect.value : 'bopomofo';

    if (sortMode === 'count') {
        sortedHerbs.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name, 'zh-TW');
        });
    } else {
        sortedHerbs.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    }

    const listDiv = document.getElementById('statsListArea');
    if (listDiv) {
        listDiv.innerHTML = sortedHerbs.map((h, index) => {
            let displaySources = h.sources.slice(0, 2).join('、');
            if (h.sources.length > 2) displaySources += ' 等...';
            let sourcesHtml = `<div style="font-size:12px; color:#e74c3c; font-weight:normal; margin-top:5px; line-height:1.4;">📍 來源參考：${displaySources}</div>`;
            
            let rankTag = sortMode === 'count' ? `<span style="font-size:11px; color:#bdc3c7; margin-right:5px;">#${index + 1}</span>` : '';

            return `
                <div class="stat-item">
                    <div>
                        <span>${rankTag}🌿 ${h.name}</span>
                        ${sourcesHtml}
                    </div>
                    <span class="stat-count">${h.count} 個複方</span>
                </div>
            `;
        }).join('');
    }
}

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
                
                if(brand !== '開源廠牌' && brand !== '未知藥廠') brandCounts[brand] = (brandCounts[brand] || 0) + 1;
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
    
    let natureDetails = { 
        "寒": { total: 0, herbs: [] }, 
        "涼": { total: 0, herbs: [] }, 
        "平": { total: 0, herbs: [] }, 
        "溫": { total: 0, herbs: [] }, 
        "熱": { total: 0, herbs: [] } 
    };

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

    const veganToggle = document.getElementById('veganToggle');
    const isVeganChecked = veganToggle ? veganToggle.checked : false;

    const list = document.getElementById('resultList'); 
    if(!list) return;
    list.innerHTML = '';
    
    Object.keys(finalHerbs).sort((a, b) => finalHerbs[b] - finalHerbs[a]).forEach(herb => {
        if(finalHerbs[herb] > 0.01){
            let alertHtml = '';
            let sourceNamesArray = Array.from(herbSources[herb] || []);
            let fullSourceNames = sourceNamesArray.map(name => getCleanDisplayName(name)).join('、');
            let abbrTags = sourceNamesArray.map(name => `<span class="source-abbr">${getAbbrName(name)}</span>`).join('');

            let lookupName = herb.replace(/[\(（]需確認.*?[\)）]/g, '').trim();
            let herbNature = "平";
            if (window.herbNatureDictionary) {
                if (window.herbNatureDictionary[lookupName]) {
                    herbNature = window.herbNatureDictionary[lookupName];
                } else if (window.herbNatureDictionary[getCoreHerbName(lookupName)]) {
                    herbNature = window.herbNatureDictionary[getCoreHerbName(lookupName)];
                }
            }

            if (natureDetails[herbNature] !== undefined) {
                natureDetails[herbNature].total += finalHerbs[herb];
                natureDetails[herbNature].herbs.push(`${lookupName} ${finalHerbs[herb].toFixed(1)}g`);
            }

            if (isAnimalHerb(herb)) {
                if (isVeganChecked) {
                    alertHtml += `<span class="tag-vegan" style="color:#c0392b; font-weight:bold; background:#fadbd8; padding:2px 4px; border-radius:3px;">🚫 純素禁忌(含動物成分)</span>`;
                } else {
                    alertHtml += `<span class="tag-animal">🍖 動物類</span>`;
                }
            }

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

    if (currentUIMode === 'clinical') {
        renderNatureChart(natureDetails, grandRaw);
    }
}

// 🌟 雙軸評估模型：動態寒熱與烈度運算 (修正模糊語氣版)
function renderNatureChart(details, totalWeight) {
    const container = document.getElementById('chartContainer');
    const ctx = document.getElementById('natureChart');
    const scaleBox = document.getElementById('thermalScaleBox'); 
    
    if (!container || !ctx || !scaleBox) return;

    if (totalWeight <= 0) {
        container.style.display = 'none';
        scaleBox.style.display = 'none';
        if (natureChartInstance) {
            natureChartInstance.destroy();
            natureChartInstance = null;
        }
        return;
    }

    container.style.display = 'block';
    
    // 雙軸核心權重定義
    const weights = { "熱": 4, "溫": 1, "平": 0, "涼": -1, "寒": -4 };
    
    let thermalSum = 0;   
    let intensitySum = 0; 

    ["熱", "溫", "平", "涼", "寒"].forEach(nature => {
        let w = details[nature].total;
        let score = weights[nature];
        thermalSum += w * score;
        intensitySum += w * Math.abs(score);
    });

    let thermalScore = thermalSum / totalWeight;
    let intensityScore = intensitySum / totalWeight;

    // 🌟 精準判斷微偏方向
    let trendText = "平穩";
    if (thermalScore > 0.1) trendText = "偏溫";
    else if (thermalScore < -0.1) trendText = "偏涼";

    // 動態決策樹渲染
    if (thermalScore >= 0.8 && intensityScore >= 2.0) {
        scaleBox.innerHTML = `🔥 大辛大熱 (攻逐寒邪之重劑)<div style="font-size:12px; margin-top:4px; font-weight:normal;">烈度極高，具有強烈溫陽散寒動能。請嚴密觀察患者上火、耗津等反應，中病即止。</div>`;
        scaleBox.style.backgroundColor = '#fbe9e7'; scaleBox.style.color = '#c62828'; scaleBox.style.border = '1px solid #ffccbc';
    } else if (thermalScore >= 0.5) {
        scaleBox.innerHTML = `☀️ 處方偏溫熱<div style="font-size:12px; margin-top:4px; font-weight:normal;">具備發散溫陽之效。請留意患者是否有口乾舌燥、便祕或上火現象。</div>`;
        scaleBox.style.backgroundColor = '#fff3e0'; scaleBox.style.color = '#e65100'; scaleBox.style.border = '1px solid #ffe0b2';
    } else if (thermalScore <= -0.8 && intensityScore >= 2.0) {
        scaleBox.innerHTML = `❄️ 苦寒清泄 (攻下清熱之重劑)<div style="font-size:12px; margin-top:4px; font-weight:normal;">烈度極高，具有強烈清熱瀉火動能。極易傷及脾胃陽氣，非實熱證慎用。</div>`;
        scaleBox.style.backgroundColor = '#e8eaf6'; scaleBox.style.color = '#1a237e'; scaleBox.style.border = '1px solid #c5cae9';
    } else if (thermalScore <= -0.5) {
        scaleBox.innerHTML = `💧 處方偏涼寒<div style="font-size:12px; margin-top:4px; font-weight:normal;">具備清熱生津之效。請留意患者脾胃是否虛寒、易腹瀉或怕冷。</div>`;
        scaleBox.style.backgroundColor = '#e3f2fd'; scaleBox.style.color = '#1565c0'; scaleBox.style.border = '1px solid #bbdefb';
    } else {
        // 第一軸落在平衡區 (-0.5 ~ 0.5)，進入細部動態判斷
        if (intensityScore >= 2.0) {
            scaleBox.innerHTML = `⚡ 寒熱交作，整體略【${trendText}】<div style="font-size:12px; margin-top:4px; font-weight:normal;">內部含有強烈對立之大寒大熱藥材。此屬辛開苦降或攻邪治病之重劑，切勿視為保養藥長期調理。</div>`;
            scaleBox.style.backgroundColor = '#fff9c4'; scaleBox.style.color = '#f57f17'; scaleBox.style.border = '1px solid #fff59d';
        } else if (intensityScore >= 0.8) {
            // 葛根湯會落在這裡，文字與顏色會依據 trendText 自動變換
            let bgC = '#f5f5f5', fontC = '#424242', borC = '#e0e0e0';
            if (trendText === "偏溫") { bgC = '#fff8e1'; fontC = '#f57f17'; borC = '#fff59d'; } // 偏橘黃
            else if (trendText === "偏涼") { bgC = '#e1f5fe'; fontC = '#0277bd'; borC = '#81d4fa'; } // 偏淡藍
            
            scaleBox.innerHTML = `💨 寒熱兼調，整體【${trendText}】<div style="font-size:12px; margin-top:4px; font-weight:normal;">本處方具備中等宣散/清解動能。適合急性期外感或輕度調節使用。</div>`;
            scaleBox.style.backgroundColor = bgC; scaleBox.style.color = fontC; scaleBox.style.border = `1px solid ${borC}`;
        } else {
            scaleBox.innerHTML = `🌿 藥性極為平和<div style="font-size:12px; margin-top:4px; font-weight:normal;">動能和緩，無明顯寒熱偏性，適合一般體質長期保養與脾胃調理。</div>`;
            scaleBox.style.backgroundColor = '#e8f5e9'; scaleBox.style.color = '#2e7d32'; scaleBox.style.border = '1px solid #c8e6c9';
        }
    }
    scaleBox.style.display = 'block';

    if (natureChartInstance) {
        natureChartInstance.destroy();
    }

    const dataValues = [details["寒"].total, details["涼"].total, details["平"].total, details["溫"].total, details["熱"].total];
    const herbLists = [details["寒"].herbs, details["涼"].herbs, details["平"].herbs, details["溫"].herbs, details["熱"].herbs];
    const labels = ["寒性", "涼性", "平性", "溫性", "熱性"];
    
    const backgroundColors = ['#1565C0', '#64B5F6', '#81C784', '#FFB300', '#C62828'];

    natureChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: backgroundColors,
                borderWidth: 1,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 10 },
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12, family: 'sans-serif' } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let index = context.dataIndex;
                            let parsed = context.parsed;
                            if (parsed === 0) return null; 
                            let percentage = (parsed / totalWeight * 100).toFixed(1) + '%';
                            let lines = [`${context.label}: ${parsed.toFixed(2)} g (${percentage})`];
                            let herbs = herbLists[index];
                            if (herbs && herbs.length > 0) {
                                lines.push('-------------------');
                                herbs.forEach(h => lines.push(` ▸ ${h}`));
                            }
                            return lines;
                        }
                    }
                }
            }
        }
    });
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

window.addEventListener('DOMContentLoaded', () => {
    loadCloudDatabase();
    
    const searchInputElem = document.getElementById('searchInput');
    if (searchInputElem) {
        searchInputElem.addEventListener('compositionstart', () => { isComposing = true; });
        searchInputElem.addEventListener('compositionend', () => { 
            isComposing = false; 
            filterDrugs(); 
        });
    }
});
