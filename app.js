// ==========================================
// 讀取本地端 CSV 資料庫 (確保 database.csv 在同個資料夾)
// 核心大腦：負責系統初始化、資料過濾、臨床換算與防呆
// ==========================================
const googleSheetCsvUrl = "database.csv";

// 🌟 全域變數 (供其他擴充 JS 讀取)
let database = []; 
let prescriptionClinical = []; 
let prescriptionLearning = []; 
let prescription = prescriptionClinical; 

let globalFinalHerbs = {}; 
let generatedTeachingPlans = []; 
let currentUIMode = 'clinical'; 

let isComposing = false;
let searchDebounceTimer = null;

// 🌟 全域圖表實例變數，用來控制圓餅圖的更新與銷毀
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

// 🌟 開發者內部工具：全單味藥物統計渲染 (加入排序切換功能)
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

    // 🌟 判斷下拉選單的排序模式
    const sortSelect = document.getElementById('statsSortSelect');
    const sortMode = sortSelect ? sortSelect.value : 'bopomofo';

    if (sortMode === 'count') {
        // 📉 模式：依頻率多到少排列 (若數量相同，則依注音輔助排列)
        sortedHerbs.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name, 'zh-TW');
        });
    } else {
        // 🔤 模式：嚴格依據注音符號順序
        sortedHerbs.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    }

    const listDiv = document.getElementById('statsListArea');
    if (listDiv) {
        listDiv.innerHTML = sortedHerbs.map((h, index) => {
            let displaySources = h.sources.slice(0, 2).join('、');
            if (h.sources.length > 2) displaySources += ' 等...';
            let sourcesHtml = `<div style="font-size:12px; color:#e74c3c; font-weight:normal; margin-top:5px; line-height:1.4;">📍 來源參考：${displaySources}</div>`;
            
            // 加入名次標籤 (僅在頻率排序時凸顯)
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
    
    // 用於統計寒熱藥性的撲滿與未建檔清單
    let natureTally = { "寒": 0, "涼": 0, "平": 0, "溫": 0, "熱": 0 };
    let neutralHerbsList = [];

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

            // 過濾括號後綴，精準匹配藥名
            let lookupName = herb.replace(/[\(（]需確認.*?[\)）]/g, '').trim();
            let herbNature = "平";
            if (window.herbNatureDictionary) {
                if (window.herbNatureDictionary[lookupName]) {
                    herbNature = window.herbNatureDictionary[lookupName];
                } else if (window.herbNatureDictionary[getCoreHerbName(lookupName)]) {
                    herbNature = window.herbNatureDictionary[getCoreHerbName(lookupName)];
                }
            }

            if (natureTally[herbNature] !== undefined) {
                natureTally[herbNature] += finalHerbs[herb];
            }
            
            // 將真正被歸類為平性的「植物類」藥材記錄下來，方便除錯
            if (herbNature === "平" && !isAnimalHerb(herb)) {
                neutralHerbsList.push(lookupName);
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

    // 觸發圖表與除錯名單渲染
    if (currentUIMode === 'clinical') {
        renderNatureChart(natureTally, grandRaw, neutralHerbsList);
    }
}

// 🌟 寒熱圓餅圖渲染與平性藥物除錯輸出
function renderNatureChart(tally, totalWeight, neutralList) {
    const container = document.getElementById('chartContainer');
    const ctx = document.getElementById('natureChart');
    const logDiv = document.getElementById('neutralHerbsLog');
    
    if (!container || !ctx) return;

    if (totalWeight <= 0) {
        container.style.display = 'none';
        if (logDiv) logDiv.style.display = 'none';
        if (natureChartInstance) {
            natureChartInstance.destroy();
            natureChartInstance = null;
        }
        return;
    }

    container.style.display = 'block';
    
    if (logDiv) {
        if (neutralList && neutralList.length > 0) {
            logDiv.innerHTML = `💡 <strong>下列藥物系統判定為平性 (含西藥成分或未收錄單方)：</strong><br>${neutralList.join('、')}`;
            logDiv.style.display = 'block';
        } else {
            logDiv.style.display = 'none';
        }
    }

    if (natureChartInstance) {
        natureChartInstance.destroy();
    }

    const dataValues = [tally["寒"], tally["涼"], tally["平"], tally["溫"], tally["熱"]];
    const labels = ["寒性", "涼性", "平性", "溫性", "熱性"];
    
    const backgroundColors = [
        '#1565C0', // 寒 (深藍)
        '#64B5F6', // 涼 (淺藍)
        '#81C784', // 平 (綠色)
        '#FFB300', // 溫 (橘色)
        '#C62828'  // 熱 (深紅)
    ];

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
                legend: {
                    position: 'right',
                    labels: { 
                        boxWidth: 12, 
                        font: { size: 12, family: 'sans-serif' } 
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed.toFixed(2) + ' g';
                                let percentage = (context.parsed / totalWeight * 100).toFixed(1) + '%';
                                label += ' (' + percentage + ')';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// 🌟 方劑雷達：鎖定兩家藥廠推導
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

// 🌟 共用工具函數：計算權重係數 (新擴充的 ai-analysis.js 也會用到)
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
