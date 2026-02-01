// main.js

const DEBUG = true;

class HajimeConverter {
    constructor() {
        this.accentIntensity = 0.7; // 訛り度（0.0〜1.0）
        this.initEventListeners();
    }

    initEventListeners() {
        // UIのイベント登録
        document.getElementById('btn-analyze').addEventListener('click', () => this.handleAnalyze());
        document.getElementById('btn-convert').addEventListener('click', () => this.handleTransform());
        document.getElementById('btn-play').addEventListener('click', () => this.handlePlay());
        document.getElementById('accent-range').addEventListener('input', (e) => {
            document.getElementById('accent-value').textContent = e.target.value + "%";
            this.accentIntensity = e.target.value / 100;
        });
    }

    // --- Phase 1: 解析 ---
    async handleAnalyze() {
        const rawText = document.getElementById('input-text').value;
        if (!rawText) return;

        // TODO: ここに形態素解析(kuroshiro等)を実装する
        const hiraganaWithSlash = await this.tokenize(rawText);
        
        document.getElementById('edit-hiragana').value = hiraganaWithSlash;
        document.getElementById('step-edit').classList.remove('hidden');
    }

    async tokenize(text) {
        // 仮の処理: 本来はここで「こんにちは」→「こ/ん/に/ち/は」にする
        return text.split('').join('/'); 
    }

    // --- Phase 2: はじめ語変換 (コアロジック) ---
    handleTransform() {
        const hiraganaInput = document.getElementById('edit-hiragana').value;
        
        // 1. ひらがな -> 発音記号 (IPA/Roman)
        const basePhonemes = this.convertToPhonemes(hiraganaInput);
        
        // 2. 発音記号 -> はじめ語音素 (確率による変化)
        const hajimePhonemes = this.applyHajimeRules(basePhonemes);
        
        // 3. はじめ語音素 -> 表示用ひらがな
        const resultHiragana = this.convertToDisplayHiragana(hajimePhonemes);
        
        this.currentHajimePhonemes = hajimePhonemes; // 再生用に保存
        document.getElementById('result-display').textContent = resultHiragana;
        document.getElementById('step-result').classList.remove('hidden');
    }

    convertToPhonemes(hiragana) {
        // TODO: ひらがなを [s, a, k, u, r, a] のような配列に分解する
        return [];
    }

    applyHajimeRules(phonemes) {
        // TODO: ポテト君が分析した「サ行 -> タ行」等の確率変換をここに書く
        return [];
    }

    convertToDisplayHiragana(hajimePhonemes) {
        // TODO: [ts, a] -> 「つぁ」のように戻す
        return "（ここに変換結果が出るよ）";
    }

    // --- Phase 3: 音声再生 ---
    handlePlay() {
        if (!this.currentHajimePhonemes) return;
        console.log("再生中:", this.currentHajimePhonemes);
        // TODO: Web Speech API または Open JTalk で再生
    }
}

// 実行
const app = new HajimeConverter();
if (DEBUG){
    alert("現在開発中のページです");
}