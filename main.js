// main.js

const DEBUG = false;

class HajimeConverter {
    constructor() {
        this.KuroshiroLib = window.Kuroshiro.default || window.Kuroshiro;
        this.kuroshiro = new this.KuroshiroLib();
        this.isReady = false;
        this.accentIntensity = 0.7; // 訛り度（0.0〜1.0）
        this.initKuroshiro();
        this.initEventListeners();
    }

    initEventListeners() {
        // UIのイベント登録
        document.getElementById('btn-analyze').addEventListener('click', () => this.handleAnalyze());
        document.getElementById('btn-convert').addEventListener('click', () => this.handleTransform());
        document.getElementById('btn-play').addEventListener('click', () => this.handlePlay());
        document.getElementById('btn-copy').addEventListener('click', () => this.handleCopy());
        document.getElementById('accent-range').addEventListener('input', (e) => {
            document.getElementById('accent-value').textContent = e.target.value + "%";
            this.accentIntensity = e.target.value / 100;
        });
        document.getElementById('btn-share-x').addEventListener('click', () => this.handleShareX());
        // ボイスリストの非同期ロード対策
        if (typeof speechSyntesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => {
                console.log("Voices loaded:", window.speechSynthesis.getVoices().length);
            };
        }
        // 音量スライダーの表示更新
        document.getElementById('volume-range').addEventListener('input', (e) => {
            const vol = Math.round(e.target.value * 100);
            document.getElementById('volume-value').textContent = vol + "%";
        });
    }

    // --- Phase 1: 解析 ---
    // 辞書をロードして初期化
    async initKuroshiro() {
        console.log("辞書をロード中...");
        const analyzer = new KuromojiAnalyzer({
            // 辞書ファイルのパス
            dictPath: "dict/"
        });
        await this.kuroshiro.init(analyzer);
        this.isReady = true;
        console.log("準備完了！");
        document.getElementById('btn-analyze').textContent = "解析を開始する";
    }

    async handleAnalyze() {
        if (!this.isReady) {
            alert("辞書のロード中です。しばらくお待ちください。");
            return;
        }
        
        const rawText = document.getElementById('input-text').value;
        if (!rawText) return;

        // 形態素解析を実行
        const hiraganaWithSlash = await this.tokenize(rawText);
        
        document.getElementById('edit-hiragana').value = hiraganaWithSlash;
        document.getElementById('step-edit').classList.remove('hidden');
    }

    // 文字列を分解して「ひらがな/区切り」にするコア処理
    async tokenize(text) {
        // kuroshiroの内部analyzer(kuromoji)のインスタンスに直接アクセスしてトークンを取得
        const tokens = await this.kuroshiro._analyzer.parse(text);
        
        let result = [];

        for (const token of tokens) {
            // 各単語をひらがなに変換
            // token.reading はカタカナなので kuroshiro でひらがなにする
            const reading = token.reading || token.surface_form;
            let kana = await this.KuroshiroLib.Util.kanaToHiragna(reading);
            
            // 漢字のまま変換できなかった場合などのフォールバック
            if (!kana) kana = token.surface_form;

            // 助詞(は, が, を) や 助動詞(です, ます) の情報を保持しておくと後の変換に便利
            // ここではシンプルに単語ごとにスラッシュを入れる
            result.push(kana);
        }

        // スラッシュで結合
        return result.join('/');
    }

    // --- Phase 2: はじめ語変換 (コアロジック) ---
    handleTransform() {
        const hiraganaInput = document.getElementById('edit-hiragana').value;
        
        // 1. ひらがな -> 発音記号 (IPA/Roman)
        const basePhonemes = this.convertToPhonemes(hiraganaInput);
        if (DEBUG){
            console.log(basePhonemes);
        }
        
        // 2. 発音記号 -> はじめ語音素 (確率による変化)
        const hajimePhonemes = this.applyHajimeRules(basePhonemes);
        if (DEBUG){
            console.log(hajimePhonemes);
        }
        
        // 3. はじめ語音素 -> 表示用ひらがな
        const resultHiragana = this.convertToDisplayHiragana(hajimePhonemes);
        
        this.currentHajimePhonemes = hajimePhonemes; // 再生用に保存
        document.getElementById('result-display').textContent = resultHiragana;
        document.getElementById('step-result').classList.remove('hidden');
    }

    convertToPhonemes(hiraganaText) {
        let phonemes = [];
        let i = 0;

        while (i < hiraganaText.length) {
            let char2 = hiraganaText.substring(i, i + 2);
            let char1 = hiraganaText.substring(i, i + 1);

            if (char1 === '/') {
                phonemes.push({type: 'boundary'});
                i++;
            } else if (PHONEME_MAP[char2]) {
                phonemes.push({...PHONEME_MAP[char2], type: 'cv'});
                i += 2;
            } else if (PHONEME_MAP[char1]) {
                phonemes.push({...PHONEME_MAP[char1], type: 'cv'});
                i++;
            } else {
                // 記号（。、！など）はそのまま保持
                phonemes.push({type: 'symbol', value: char1});
                i++;
            }
        }
        return phonemes;
    }

    // 重複した音素を綺麗にする関数
    normalizePhoneme(c) {
        // 1. chy -> ch, shy -> sh, jy -> j, tsy -> ts のように y を吸収させる
        if (c.startsWith('ch') || c.startsWith('sh') || c.startsWith('j') || c.startsWith('ts')) {
            // yが含まれていたら消す（例: chy -> ch）
            return c.replace('y', '');
        }
        return c;
    }

    applyHajimeRules(phonemes) {
        // 確率判定用のヘルパー関数 (訛り度が高いほど true になりやすい)
        const chance = (weight = 1.0) => {
            return Math.random() < (this.accentIntensity * weight);
        };

        return phonemes.map((p, index) => {
            // 記号や区切りはそのまま
            if (p.type !== 'cv') return p;

            // クローンを作成して変更を加える
            let newP = { ...p };
            
            const nextNode = phonemes[index + 1];
            const prevNode = phonemes[index - 1]; // 前の音を参照用に追加

            // 文末判定
            const isFinal = !nextNode || nextNode.type === 'boundary' || nextNode.type === 'symbol';

            // --- 追加ロジック: 「い」の連続による「〜しゃー」化判定 ---
            // 条件：次の音が「子音なしの『い』」かつ、それが文末/区切りである
            const isFollowedByFinalI = nextNode && nextNode.c === '' && nextNode.v === 'i' && 
                (!phonemes[index + 2] || phonemes[index + 2].type === 'boundary' || phonemes[index + 2].type === 'symbol');

            // 条件：自分が「文末の『い』」で、一つ前の音が『い』段である
            const isFinalVowelI = p.c === '' && p.v === 'i' && isFinal;

            // --- Rule 1: サ行の変化 (S -> TS / SH / CH) ---
            if (p.c === 's') {
                // さ -> つぁ (高確率)
                if (p.v === 'a' && chance(0.8)) {
                    newP.c = 'ts'; 
                }
                // し -> ち (語尾や付属語で起こりやすい)
                else if (p.v === 'i') {
                    if (isFinal && chance(0.9)) {
                        newP.c = 'ch'; // うれちい
                    } else if (chance(0.4)) {
                        newP.c = 'ch'; // ランダム変化
                    }
                }
                // す -> しゅ / ちゅ
                else if (p.v === 'u') {
                    if (chance(0.6)) newP.c = 'sh'; // しゅ
                    else if (chance(0.3)) newP.c = 'ch'; // ちゅ
                }
                // そ -> つぉ
                else if (p.v === 'o' && chance(0.5)) {
                    newP.c = 'ts';
                }
            }

            // --- Rule 2: つ -> ちゅ (TS -> CH) ---
            if (p.c === 't' && p.v === 'u') {
                if (chance(0.6)) newP.c = 'ch'; // ちゅぎ (次)
            }

            // --- Rule 3: ダ行・ラ行の入れ替わり (D <-> R) ---
            // だ -> ら (脱力)
            if (p.c === 'd' && chance(0.4)) {
                newP.c = 'r';
                // 語尾の「～ですけど」 -> 「～ですけろ」
                if (isFinal && p.v === 'o') newP.v = 'o';
                // で -> れ は低確率
                if (p.v === 'e' && chance(0.8)) newP.c = 'd';
                // ぢ、づは無視
                if (p.v === 'i') newP.c = 'd';
                if (p.v === 'u') newP.c = 'd';
            }
            // れ -> で (破裂化)
            else if (p.c === 'r' && ['e', 'a', 'o'].includes(p.v) && chance(0.2)) {
                newP.c = 'd';
            }
            else if (p.c === 'r' && p.v === 'i' && chance(0.2)) {
                newP.c = 'dh';
            }
            

            // --- Rule 4: 母音の変異 (語尾・区切りで顕著) ---
            if (isFinal) {
                // A. め/ね/け/て -> みゃ/にゃ/きゃ/ちゃ
                if (p.v === 'e' && chance(0.8)) {
                    if (['m', 'n', 'k', 'g', 'h', 'b', 'p'].includes(newP.c)) {
                        newP.c += 'y'; newP.v = 'a';
                    } else if (newP.c === 't') {
                        newP.c = 'ch'; newP.v = 'a';
                    } else if (newP.c === 'r') {
                        newP.c = 'ry'; newP.v = 'a';
                    }
                }
                // B. い -> や (通常の単発の「い」)
                else if (p.v === 'i' && chance(0.5)) {
                    // 前の音が 'i' 段でない場合のみ、単体の「や」にする
                    if (!(prevNode && prevNode.v === 'i')) {
                        if (['s'].includes(newP.c)) newP.c += 'h';
                        else if (['k','n','h','m','r','g','d','b','p'].includes(newP.c)) newP.c += 'y';
                        else if (newP.c === 't') newP.c = 'ch';
                        else if (newP.c === 'z') newP.c = 'j';
                        newP.v = 'a';
                        if (newP.c === '') newP.v = 'i';
                    }
                }
    
                // C. 「うれしい」→「うれしゃー」の「ー」部分の処理
                if (isFinalVowelI && prevNode && prevNode.v === 'i' && chance(0.9)) {
                    newP.c = 'L'; // 長音(Long vowel)フラグ
                    newP.v = '';
                }
            }
    
            // D. 「うれしい」の「し」を「しゃ」にする処理 (次に文末の『い』が控えている場合)
            if (isFollowedByFinalI && p.v === 'i' && chance(0.9)) {
                newP.v = 'a';
                if (newP.c === 's') newP.c = 'sh';
                else if (newP.c === 't') newP.c = 'ch';
                else if (['k','n','h','m','r','g','b','p'].includes(newP.c)) newP.c += 'y';
                // newP.c が空（あいうえおの「い」）の場合はそのまま
            }
            
            // --- Rule 5: 語中の謎の「j」混入 ---
            // まぐろ -> まぎゅろ
            if (!isFinal && p.v === 'u' && chance(0.2)) {
                 if (!newP.c.includes('y') && !['s', 't', 'j'].includes(newP.c) && newP.c!=='') {
                     newP.c += 'y';
                 }
            }

            // --- 最後に正規化をかける ---
            newP.c = this.normalizePhoneme(newP.c);

            return newP;
        });
    }

    convertToDisplayHiragana(phonemes) {
        // 音素結合用のマップ
        const reverseMap = (c, v) => {
            // 直接マッピングできる特殊な音（ここを優先）
            const specials = {
                'tsa': 'つぁ', 'tso': 'つぉ', 'tse': 'つぇ',
                'cha': 'ちゃ', 'chu': 'ちゅ', 'cho': 'ちょ', 'chi': 'ち',
                'sha': 'しゃ', 'shu': 'しゅ', 'sho': 'しょ', 'shi': 'し',
                'dhi': 'でぃ', 'gya': 'ぎゃ', 'dya': 'でゃ', 'bya': 'びゃ',
                'pya': 'ぴゃ',
                'ja': 'じゃ', 'ju': 'じゅ', 'jo': 'じょ', 'ji': 'じ'
            };
            if (specials[c + v]) return specials[c + v];
    
            // 拗音系 (ky, ny, my... + a, u, o) の判定
            if (c.endsWith('y')) {
                const base = c.slice(0, -1); 
                const smallVowel = {'a': 'ゃ', 'u': 'ゅ', 'o': 'ょ'}[v];
                const baseChar = this.getBaseChar(base);
                if (baseChar && smallVowel) return baseChar + smallVowel;
            }
    
            // それ以外は通常の逆引き
            return this.simpleReverseLookup(c, v);
        };

        return phonemes.map(p => {
            if (p.type === 'boundary') return ' '; // 区切りはスペースか空文字に
            if (p.type === 'symbol') return p.value;
            if (p.type === 'cv') {
                return reverseMap(p.c, p.v);
            }
            return '';
        }).join('');
    }

    // 拗音の土台になる文字を返すヘルパー
    getBaseChar(consonant) {
        const map = {
            'k': 'き', 's': 'し', 't': 'ち', 'n': 'に', 'h': 'ひ', 
            'm': 'み', 'r': 'り', 'g': 'ぎ', 'z': 'じ', 'd': 'ぢ', 
            'b': 'び', 'p': 'ぴ'
        };
        return map[consonant] || '';
    }

    // 基本的な音の復元
    simpleReverseLookup(c, v) {
        // ローマ字入力のようなロジックで対応
        // 実際には PHONEME_MAP の逆引きを行うのが確実
        // ここではポテト君が持っている PHONEME_MAP を使って逆引きするコードを推奨
        
        // グローバルまたはクラス内の PHONEME_MAP を走査
        for (const [kana, phoneme] of Object.entries(PHONEME_MAP)) {
            if (phoneme.c === c && phoneme.v === v) return kana;
        }
        // 見つからない場合のフォールバック（デバッグ用）
        return `[${c}${v}]`;
    }

    // --- Phase 3: 音声再生 ---
    handlePlay() {
        // 表示されている変換結果のテキストを取得
        const textToPlay = document.getElementById('result-display').textContent;
        
        if (!textToPlay) {
            alert("再生するテキストがありません。");
            return;
        }

        // 以前の再生をキャンセル
        window.speechSynthesis.cancel();

        // 発話インスタンスの作成
        const uttr = new SpeechSynthesisUtterance(textToPlay);
        
        // 言語設定
        uttr.lang = 'ja-JP';

        // 声質の調整 (はじめ風パラメータ)
        // pitch: 0(低) ~ 2(高)。1.2 ~ 1.4 あたりがアニメ声っぽくなる
        uttr.pitch = 1.3; 
        
        // rate: 0.1(遅) ~ 10(速)。少し早口にする
        uttr.rate = 1.1; 
        
        // 音量
        // スライダーの値を取得して適用
        const volumeValue = document.getElementById('volume-range').value;
        uttr.volume = parseFloat(volumeValue);

        // ボイスの選択（ブラウザによって利用可能なボイスが違う）
        const voices = window.speechSynthesis.getVoices();
        // Google 日本語、Microsoft Ayumi/Haruka などを優先的に探す
        const jpVoice = voices.find(v => 
            (v.lang === 'ja-JP' || v.lang === 'ja_JP') && 
            (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Apple'))
        );
        
        if (jpVoice) {
            uttr.voice = jpVoice;
            console.log("Selected Voice:", jpVoice.name);
        }

        // 再生開始
        window.speechSynthesis.speak(uttr);

        // 再生中のUIフィードバック（オプション）
        uttr.onstart = () => {
            document.getElementById('btn-play').textContent = "🔊 再生中...";
            document.getElementById('btn-play').disabled = true;
        };
        
        uttr.onend = () => {
            document.getElementById('btn-play').textContent = "▶ 再生する";
            document.getElementById('btn-play').disabled = false;
        };
    }

    // --- Phase 4: その他ユーティリティ ---

    async handleCopy() {
        const resultText = document.getElementById('result-display').textContent;
        
        if (!resultText) {
            alert("コピーするテキストがありません。");
            return;
        }

        try {
            // クリップボードに書き込み
            await navigator.clipboard.writeText(resultText);
            
            // フィードバック演出
            const btn = document.getElementById('btn-copy');
            const originalText = btn.textContent;
            btn.textContent = "✅ コピー完了！";
            btn.style.background = "var(--hajime-cyan)"; // イメージカラーに変更
            btn.style.color = "#2e2a41";

            // 1.5秒後に元に戻す
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = ""; // CSSの設定に戻る
                btn.style.color = "";
            }, 1500);

        } catch (err) {
            console.error("コピーに失敗しました:", err);
            alert("コピーに失敗しました。お使いのブラウザの設定を確認してね。");
        }
    }

    handleShareX() {
        const resultText = document.getElementById('result-display').textContent;
        
        if (!resultText) {
            alert("投稿するテキストがありません。");
            return;
        }

        // 投稿文の組み立て
        const tweetText = `${resultText}\n\n#轟はじめ #はじめ語変換ツール`;
        const tweetUrl = window.location.href; // 現在のツールのURL（GitHub Pages等）

        // Intent URL の作成
        const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(tweetUrl)}`;

        // 新しいウィンドウで開く
        window.open(shareUrl, '_blank', 'width=550,height=420');
    }
}

// 実行
const app = new HajimeConverter();
if (DEBUG){
    alert("現在開発中のページです");
}

const PHONEME_MAP = {
    // 母音のみ
    'あ': {c: '', v: 'a'}, 'い': {c: '', v: 'i'}, 'う': {c: '', v: 'u'}, 'え': {c: '', v: 'e'}, 'お': {c: '', v: 'o'},
    // 子音+母音
    'か': {c: 'k', v: 'a'}, 'き': {c: 'k', v: 'i'}, 'く': {c: 'k', v: 'u'}, 'け': {c: 'k', v: 'e'}, 'こ': {c: 'k', v: 'o'},
    'さ': {c: 's', v: 'a'}, 'し': {c: 's', v: 'i'}, 'す': {c: 's', v: 'u'}, 'せ': {c: 's', v: 'e'}, 'そ': {c: 's', v: 'o'},
    'た': {c: 't', v: 'a'}, 'ち': {c: 't', v: 'i'}, 'つ': {c: 't', v: 'u'}, 'て': {c: 't', v: 'e'}, 'と': {c: 't', v: 'o'},
    'な': {c: 'n', v: 'a'}, 'に': {c: 'n', v: 'i'}, 'ぬ': {c: 'n', v: 'u'}, 'ね': {c: 'n', v: 'e'}, 'の': {c: 'n', v: 'o'},
    'は': {c: 'h', v: 'a'}, 'ひ': {c: 'h', v: 'i'}, 'ふ': {c: 'h', v: 'u'}, 'へ': {c: 'h', v: 'e'}, 'ほ': {c: 'h', v: 'o'},
    'ま': {c: 'm', v: 'a'}, 'み': {c: 'm', v: 'i'}, 'む': {c: 'm', v: 'u'}, 'め': {c: 'm', v: 'e'}, 'も': {c: 'm', v: 'o'},
    'や': {c: 'y', v: 'a'}, 'ゆ': {c: 'y', v: 'u'}, 'よ': {c: 'y', v: 'o'},
    'ら': {c: 'r', v: 'a'}, 'り': {c: 'r', v: 'i'}, 'る': {c: 'r', v: 'u'}, 'れ': {c: 'r', v: 'e'}, 'ろ': {c: 'r', v: 'o'},
    'わ': {c: 'w', v: 'a'}, 'を': {c: 'w', v: 'o'}, 'ん': {c: 'N', v: ''},
    // 濁音・半濁音
    'が': {c: 'g', v: 'a'}, 'ぎ': {c: 'g', v: 'i'}, 'ぐ': {c: 'g', v: 'u'}, 'げ': {c: 'g', v: 'e'}, 'ご': {c: 'g', v: 'o'},
    'ざ': {c: 'z', v: 'a'}, 'じ': {c: 'z', v: 'i'}, 'ず': {c: 'z', v: 'u'}, 'ぜ': {c: 'z', v: 'e'}, 'ぞ': {c: 'z', v: 'o'},
    'だ': {c: 'd', v: 'a'}, 'ぢ': {c: 'd', v: 'i'}, 'づ': {c: 'd', v: 'u'}, 'で': {c: 'd', v: 'e'}, 'ど': {c: 'd', v: 'o'},
    'ば': {c: 'b', v: 'a'}, 'び': {c: 'b', v: 'i'}, 'ぶ': {c: 'b', v: 'u'}, 'べ': {c: 'b', v: 'e'}, 'ぼ': {c: 'b', v: 'o'},
    'ぱ': {c: 'p', v: 'a'}, 'ぴ': {c: 'p', v: 'i'}, 'ぷ': {c: 'p', v: 'u'}, 'ぺ': {c: 'p', v: 'e'}, 'ぽ': {c: 'p', v: 'o'},
    // 拗音（2文字優先）
    'きゃ': {c: 'ky', v: 'a'}, 'きゅ': {c: 'ky', v: 'u'}, 'きょ': {c: 'ky', v: 'o'},
    'しゃ': {c: 'sh', v: 'a'}, 'しゅ': {c: 'sh', v: 'u'}, 'しょ': {c: 'sh', v: 'o'},
    'ちゃ': {c: 'ch', v: 'a'}, 'ちゅ': {c: 'ch', v: 'u'}, 'ちょ': {c: 'ch', v: 'o'},
    'にゃ': {c: 'ny', v: 'a'}, 'にゅ': {c: 'ny', v: 'u'}, 'にょ': {c: 'ny', v: 'o'},
    'ひゃ': {c: 'hy', v: 'a'}, 'ひゅ': {c: 'hy', v: 'u'}, 'ひょ': {c: 'hy', v: 'o'},
    'みゃ': {c: 'my', v: 'a'}, 'みゅ': {c: 'my', v: 'u'}, 'みょ': {c: 'my', v: 'o'},
    'りゃ': {c: 'ry', v: 'a'}, 'りゅ': {c: 'ry', v: 'u'}, 'りょ': {c: 'ry', v: 'o'},
    'ぎゃ': {c: 'gy', v: 'a'}, 'ぎゅ': {c: 'gy', v: 'u'}, 'ぎょ': {c: 'gy', v: 'o'},
    'じゃ': {c: 'j', v: 'a'}, 'じゅ': {c: 'j', v: 'u'}, 'じょ': {c: 'j', v: 'o'},
    'びゃ': {c: 'by', v: 'a'}, 'びゅ': {c: 'by', v: 'u'}, 'びょ': {c: 'by', v: 'o'},
    'ぴゃ': {c: 'py', v: 'a'}, 'ぴゅ': {c: 'py', v: 'u'}, 'ぴょ': {c: 'py', v: 'o'},
    // 特殊
    'っ': {c: 'Q', v: ''}, 'ー': {c: 'L', v: ''}
};