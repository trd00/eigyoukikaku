/* ============================================================
   まえば小児科 WEB問診 — 質問項目の定義
   ここを編集すれば、画面側のコードを変えずに質問を追加・削除・変更できる。
   （要件11-5 保守性 / 要件6-1-3 条件分岐）

   質問の書き方
     id       : 回答を識別するキー。重複不可。
     type     : radio / checkbox / select / text / textarea / number
                / date / datetime-local / tel / temperature
     label    : 患者・保護者に表示する質問文（医療用語は避ける）
     help     : 補足説明
     required : 必須入力にする
     options  : 選択肢。['値','表示'] または '値'
     unit     : 数値の単位表示（cm / kg など）
     showIf   : 表示条件。{q:'質問id', op:'eq|ne|in|any|gte', v:値}
                配列で渡すとすべて満たしたときだけ表示（AND）
     urgent   : 注意喚起の条件。{op:'eq|in|gte|lte', v:値, msg:'文言', level:'high|critical'}
                ageUnderMonths を足すと「その月齢未満のときだけ」判定する
     summary  : true にすると医院側一覧の「主な症状」に表示される
   ============================================================ */

const VISIT_TYPES = [
  { id: 'first',    icon: '🩺', label: '初めての受診',       desc: '当院を初めて受診される方' },
  { id: 'repeat',   icon: '🔄', label: '再診',               desc: '前回の続きで受診される方' },
  { id: 'fever',    icon: '🌡️', label: '発熱・かぜ・感染症', desc: '熱・せき・嘔吐・下痢・発疹など' },
  { id: 'vaccine',  icon: '💉', label: '予防接種',           desc: '各種ワクチンの接種' },
  { id: 'checkup',  icon: '📏', label: '健診',               desc: '乳幼児健診・入園前健診など' },
];

/* よく使う選択肢 */
const YN = [['あり','あり'],['なし','なし']];
const YN_UNKNOWN = [['あり','あり'],['なし','なし'],['わからない','わからない']];

const MONSHIN_SCHEMA = {

  /* ========== 初診（要件6-2） ========== */
  first: {
    title: '初めての受診',
    sections: [
      {
        title: '今日の症状',
        desc: '気になっていることを教えてください',
        questions: [
          { id: 'f_symptoms', type: 'checkbox', required: true, summary: true,
            label: '今日いちばん困っている症状はどれですか',
            help: 'あてはまるものをすべて選んでください',
            options: ['発熱','せき','鼻水・鼻づまり','のどの痛み','嘔吐','下痢','腹痛','発疹・湿疹','耳の痛み','目の症状','けいれん','元気がない','食欲がない','その他'] },
          { id: 'f_symptom_other', type: 'text', label: 'その他の症状を教えてください',
            showIf: { q: 'f_symptoms', op: 'in', v: ['その他'] } },
          { id: 'f_onset', type: 'date', required: true, label: 'いつごろから症状がありますか' },
          { id: 'f_course', type: 'radio', required: true, label: 'その後の様子はいかがですか',
            options: ['よくなってきている','変わらない','悪くなってきている'],
            urgent: { op: 'eq', v: '悪くなってきている', level: 'high',
                      msg: '症状が悪化しています。診察までに強くなるようならご連絡ください。' } },
          { id: 'f_temp', type: 'temperature', label: '今の体温', help: '測っていれば入力してください',
            urgent: [
              { op: 'gte', v: 38, ageUnderMonths: 3, level: 'critical',
                msg: '生後3か月未満で38℃以上の発熱です。すぐにお電話ください。' },
              { op: 'gte', v: 40, level: 'high', msg: '40℃以上の高熱です。' },
            ] },
          { id: 'f_worst', type: 'checkbox', label: '次のような様子はありますか',
            help: 'あてはまるものがあれば選んでください。なければ選ばなくて構いません。',
            options: ['呼吸が苦しそう','ぐったりして反応が鈍い','けいれんしている・した','顔色が悪い','水分が飲めない'],
            urgent: { op: 'in', v: ['呼吸が苦しそう','ぐったりして反応が鈍い','けいれんしている・した','顔色が悪い','水分が飲めない'],
                      level: 'critical', msg: '至急の対応が必要な可能性があります。' } },
        ],
      },
      {
        title: 'これまでの病気・アレルギー',
        questions: [
          { id: 'f_history', type: 'radio', required: true, label: 'これまでに大きな病気にかかったことはありますか', options: YN_UNKNOWN },
          { id: 'f_history_detail', type: 'textarea', label: '病名と時期を教えてください',
            placeholder: '例：熱性けいれん（2歳）', showIf: { q: 'f_history', op: 'eq', v: 'あり' } },
          { id: 'f_admission', type: 'radio', required: true, label: '入院したことはありますか', options: YN_UNKNOWN },
          { id: 'f_admission_detail', type: 'textarea', label: '理由と時期を教えてください',
            showIf: { q: 'f_admission', op: 'eq', v: 'あり' } },
          { id: 'f_surgery', type: 'radio', required: true, label: '手術を受けたことはありますか', options: YN_UNKNOWN },
          { id: 'f_surgery_detail', type: 'textarea', label: '手術の内容と時期を教えてください',
            showIf: { q: 'f_surgery', op: 'eq', v: 'あり' } },
          { id: 'f_allergy', type: 'radio', required: true, label: 'アレルギーはありますか', options: YN_UNKNOWN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: 'アレルギーの申告があります。' } },
          { id: 'f_allergy_kind', type: 'checkbox', label: 'どのアレルギーですか',
            options: ['食べ物','薬','その他'], showIf: { q: 'f_allergy', op: 'eq', v: 'あり' } },
          { id: 'f_allergy_food', type: 'textarea', label: '食べ物：原因と、出た症状を教えてください',
            placeholder: '例：卵　→　じんましん', showIf: { q: 'f_allergy_kind', op: 'in', v: ['食べ物'] } },
          { id: 'f_allergy_drug', type: 'textarea', label: 'お薬：薬の名前と、出た症状を教えてください',
            showIf: { q: 'f_allergy_kind', op: 'in', v: ['薬'] } },
          { id: 'f_allergy_other', type: 'textarea', label: 'その他のアレルギーを教えてください',
            showIf: { q: 'f_allergy_kind', op: 'in', v: ['その他'] } },
        ],
      },
      {
        title: 'お薬・他の医療機関',
        questions: [
          { id: 'f_meds', type: 'radio', required: true, label: '今飲んでいるお薬はありますか', options: YN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: '服薬中です。' } },
          { id: 'f_meds_detail', type: 'textarea', label: 'お薬の名前を教えてください',
            help: 'お薬手帳をお持ちの方は、受付でご提示ください', showIf: { q: 'f_meds', op: 'eq', v: 'あり' } },
          { id: 'f_other_clinic', type: 'radio', required: true, label: '今回の症状で、他の病院を受診しましたか', options: YN },
          { id: 'f_other_clinic_detail', type: 'text', label: '病院名と受診日を教えてください',
            showIf: { q: 'f_other_clinic', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: '生まれたときのこと・予防接種',
        desc: '母子手帳をお手元にご用意ください',
        questions: [
          { id: 'f_birth_week', type: 'number', label: '生まれたときの週数', unit: '週', placeholder: '例：40' },
          { id: 'f_birth_weight', type: 'number', label: '生まれたときの体重', unit: 'g', placeholder: '例：3000' },
          { id: 'f_birth_trouble', type: 'radio', label: '生まれたときに何か問題を指摘されましたか', options: YN_UNKNOWN },
          { id: 'f_birth_trouble_detail', type: 'textarea', label: '内容を教えてください',
            showIf: { q: 'f_birth_trouble', op: 'eq', v: 'あり' } },
          { id: 'f_vaccine_status', type: 'radio', required: true, label: '予防接種の状況を教えてください',
            options: ['母子手帳のとおり受けている','受けていないものがある','ほとんど受けていない','わからない'] },
          { id: 'f_checkup_status', type: 'radio', label: '乳幼児健診は受けていますか',
            options: ['受けている','受けていないものがある','受けていない'] },
        ],
      },
      {
        title: '先生に伝えたいこと',
        questions: [
          { id: 'f_note', type: 'textarea', label: '心配なこと・相談したいことがあればご記入ください',
            placeholder: '診察のときにお伝えします' },
        ],
      },
    ],
  },

  /* ========== 再診（要件6-3） ========== */
  repeat: {
    title: '再診',
    sections: [
      {
        title: '前回からの様子',
        questions: [
          { id: 'r_symptoms', type: 'checkbox', required: true, summary: true,
            label: '今日いちばん気になる症状はどれですか',
            options: ['発熱','せき','鼻水・鼻づまり','のどの痛み','嘔吐','下痢','腹痛','発疹・湿疹','耳の痛み','元気がない','食欲がない','症状はおさまった','その他'] },
          { id: 'r_symptom_other', type: 'text', label: 'その他の症状を教えてください',
            showIf: { q: 'r_symptoms', op: 'in', v: ['その他'] } },
          { id: 'r_course', type: 'radio', required: true, label: '前回の受診のあと、症状はどうなりましたか',
            options: ['よくなった','少しよくなった','変わらない','悪くなった'],
            urgent: { op: 'eq', v: '悪くなった', level: 'high', msg: '前回受診後に症状が悪化しています。' } },
          { id: 'r_new', type: 'radio', required: true, label: '新しく出てきた症状はありますか', options: YN },
          { id: 'r_new_detail', type: 'textarea', label: '新しく出てきた症状を教えてください',
            showIf: { q: 'r_new', op: 'eq', v: 'あり' } },
          { id: 'r_temp', type: 'temperature', label: '今の体温',
            urgent: { op: 'gte', v: 39, level: 'high', msg: '39℃以上の発熱があります。' } },
        ],
      },
      {
        title: '前回のお薬について',
        questions: [
          { id: 'r_taking', type: 'radio', required: true, label: '前回のお薬は飲めていますか',
            options: ['指示どおり飲んでいる','ときどき飲めていない','ほとんど飲めていない','もう飲み終わった'] },
          { id: 'r_taking_reason', type: 'text', label: '飲めなかった理由があれば教えてください',
            placeholder: '例：苦くて嫌がる', showIf: { q: 'r_taking', op: 'in', v: ['ときどき飲めていない','ほとんど飲めていない'] } },
          { id: 'r_effect', type: 'radio', required: true, label: 'お薬は効いている感じがしますか',
            options: ['効いている','どちらともいえない','効いている感じがしない'] },
          { id: 'r_side', type: 'radio', required: true, label: 'お薬を飲んで、気になる症状は出ましたか', options: YN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: '薬による副作用の疑いがあります。' } },
          { id: 'r_side_detail', type: 'textarea', label: 'どのような症状か教えてください',
            showIf: { q: 'r_side', op: 'eq', v: 'あり' } },
          { id: 'r_other_clinic', type: 'radio', label: '前回のあと、他の病院を受診しましたか', options: YN },
          { id: 'r_other_clinic_detail', type: 'text', label: '病院名と受診日を教えてください',
            showIf: { q: 'r_other_clinic', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: '先生に伝えたいこと',
        questions: [
          { id: 'r_note', type: 'textarea', label: '相談したいことがあればご記入ください' },
        ],
      },
    ],
  },

  /* ========== 発熱・感染症（要件6-4） ========== */
  fever: {
    title: '発熱・かぜ・感染症',
    sections: [
      {
        title: '熱について',
        questions: [
          { id: 'v_temp', type: 'temperature', required: true, summary: true, label: '今の体温',
            urgent: [
              { op: 'gte', v: 38, ageUnderMonths: 3, level: 'critical',
                msg: '生後3か月未満で38℃以上の発熱です。すぐにお電話ください。' },
              { op: 'gte', v: 40, level: 'high', msg: '40℃以上の高熱です。' },
            ] },
          { id: 'v_temp_max', type: 'temperature', label: 'これまででいちばん高かった体温' },
          { id: 'v_fever_start', type: 'datetime-local', required: true, label: '熱が出はじめたのはいつ頃ですか' },
          { id: 'v_antipyretic', type: 'radio', required: true, label: '解熱剤（熱さまし）を使いましたか', options: YN },
          { id: 'v_antipyretic_time', type: 'datetime-local', label: '最後に使ったのはいつですか',
            showIf: { q: 'v_antipyretic', op: 'eq', v: 'あり' } },
          { id: 'v_antipyretic_name', type: 'text', label: '使ったお薬の名前',
            placeholder: '例：カロナール', showIf: { q: 'v_antipyretic', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: '熱のほかの症状',
        desc: 'あてはまるものをすべて選んでください',
        questions: [
          { id: 'v_symptoms', type: 'checkbox', summary: '症状', label: '今ある症状',
            options: ['せき','鼻水・鼻づまり','のどの痛み','息が苦しそう','嘔吐','下痢','腹痛','発疹','頭痛','けいれん','耳の痛み','目やに'],
            urgent: [
              { op: 'in', v: ['息が苦しそう'], level: 'critical', msg: '呼吸が苦しそうとの回答があります。' },
              { op: 'in', v: ['けいれん'], level: 'critical', msg: 'けいれんの症状があります。' },
            ] },
          { id: 'v_seizure_now', type: 'radio', label: 'けいれんは今も続いていますか',
            options: ['おさまった','今も続いている'], showIf: { q: 'v_symptoms', op: 'in', v: ['けいれん'] },
            urgent: { op: 'eq', v: '今も続いている', level: 'critical',
                      msg: 'けいれんが継続しています。すぐに救急要請または当院へお電話ください。' } },
          { id: 'v_seizure_len', type: 'text', label: 'けいれんはどのくらい続きましたか',
            placeholder: '例：2分くらい', showIf: { q: 'v_symptoms', op: 'in', v: ['けいれん'] } },
          { id: 'v_cough_level', type: 'radio', label: 'せきの様子を教えてください',
            options: ['ときどき出る','眠れないほど出る','ゼーゼー・ヒューヒューする'],
            showIf: { q: 'v_symptoms', op: 'in', v: ['せき'] },
            urgent: { op: 'eq', v: 'ゼーゼー・ヒューヒューする', level: 'high', msg: '喘鳴（ゼーゼー）があります。' } },
          { id: 'v_vomit_count', type: 'text', label: '今日は何回くらい吐きましたか',
            placeholder: '例：3回', showIf: { q: 'v_symptoms', op: 'in', v: ['嘔吐'] } },
          { id: 'v_diarrhea_count', type: 'text', label: '今日は何回くらい下痢をしましたか',
            showIf: { q: 'v_symptoms', op: 'in', v: ['下痢'] } },
        ],
      },
      {
        title: 'お子さまのご様子',
        desc: '診察の順番を判断するために大切な項目です',
        questions: [
          { id: 'v_drink', type: 'radio', required: true, label: '水分はとれていますか',
            options: ['いつもどおり飲める','少しなら飲める','ほとんど飲めない'],
            urgent: { op: 'eq', v: 'ほとんど飲めない', level: 'critical', msg: '水分がとれていません。脱水の心配があります。' } },
          { id: 'v_eat', type: 'radio', required: true, label: '食事はとれていますか',
            options: ['いつもどおり食べる','少しなら食べる','食べられない'] },
          { id: 'v_urine', type: 'radio', required: true, label: 'おしっこは出ていますか',
            options: ['いつもどおり出ている','少ない','半日以上出ていない'],
            urgent: { op: 'eq', v: '半日以上出ていない', level: 'critical', msg: '半日以上排尿がありません。脱水の心配があります。' } },
          { id: 'v_energy', type: 'radio', required: true, label: '機嫌・元気はいかがですか',
            options: ['いつもどおり元気','少し元気がない','ぐったりしている'],
            urgent: { op: 'eq', v: 'ぐったりしている', level: 'critical', msg: 'ぐったりしているとの回答があります。' } },
          { id: 'v_consciousness', type: 'radio', required: true, label: '呼びかけへの反応はいかがですか',
            options: ['はっきりしている','少しぼんやりしている','반応が鈍い・眠り込んでいる'],
            urgent: { op: 'eq', v: '반応が鈍い・眠り込んでいる', level: 'critical', msg: '意識状態に変化があります。' } },
          { id: 'v_face', type: 'radio', label: '顔色はいかがですか',
            options: ['いつもどおり','少し悪い','とても悪い・くちびるが紫っぽい'],
            urgent: { op: 'eq', v: 'とても悪い・くちびるが紫っぽい', level: 'critical', msg: '顔色不良・チアノーゼの疑いがあります。' } },
        ],
      },
      {
        title: 'まわりの流行と検査',
        questions: [
          { id: 'v_contact', type: 'radio', required: true, summary: '感染症接触',
            label: 'ご家族や園・学校で、感染症にかかった方はいますか', options: YN_UNKNOWN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: '感染症の接触歴があります。' } },
          { id: 'v_contact_detail', type: 'checkbox', label: 'どの感染症ですか',
            options: ['インフルエンザ','新型コロナ','溶連菌','手足口病','おたふくかぜ','水ぼうそう','はしか','胃腸炎','RSウイルス','その他・わからない'],
            showIf: { q: 'v_contact', op: 'eq', v: 'あり' } },
          { id: 'v_contact_who', type: 'text', label: 'どなたですか（続柄・園/学校など）',
            placeholder: '例：兄　保育園で流行', showIf: { q: 'v_contact', op: 'eq', v: 'あり' } },
          { id: 'v_home_test', type: 'radio', label: 'ご自宅で検査をしましたか', options: YN },
          { id: 'v_home_test_result', type: 'text', label: '検査の種類と結果を教えてください',
            placeholder: '例：コロナ抗原検査　陰性', showIf: { q: 'v_home_test', op: 'eq', v: 'あり' } },
          { id: 'v_want_test', type: 'radio', label: '検査のご希望はありますか',
            options: ['希望する','医師におまかせする','希望しない'],
            help: '検査を行うかどうかは、診察のうえで医師が判断します' },
        ],
      },
      {
        title: '先生に伝えたいこと',
        questions: [
          { id: 'v_note', type: 'textarea', label: '心配なこと・相談したいことがあればご記入ください' },
        ],
      },
    ],
  },

  /* ========== 予防接種（要件6-5） ========== */
  vaccine: {
    title: '予防接種',
    sections: [
      {
        title: '希望する予防接種',
        questions: [
          { id: 'w_vaccines', type: 'checkbox', required: true, summary: '希望',
            label: '今日希望する予防接種を選んでください',
            help: 'あてはまるものをすべて選んでください',
            options: ['ヒブ','小児用肺炎球菌','B型肝炎','ロタウイルス','四種混合','五種混合','BCG','MR（麻しん風しん）','水痘（みずぼうそう）','日本脳炎','おたふくかぜ','HPV（子宮頸がん）','インフルエンザ','新型コロナ','その他'] },
          { id: 'w_vaccine_other', type: 'text', label: 'その他のワクチン名',
            showIf: { q: 'w_vaccines', op: 'in', v: ['その他'] } },
          { id: 'w_dose', type: 'text', label: '今回は何回目の接種ですか',
            placeholder: '例：ヒブ3回目', help: 'わかる範囲で構いません' },
          { id: 'w_last_date', type: 'date', label: '前回、同じワクチンを接種した日',
            help: '母子手帳をご確認ください' },
          { id: 'w_recent_vaccine', type: 'radio', required: true,
            label: '最近（4週間以内）に他の予防接種を受けましたか', options: YN_UNKNOWN },
          { id: 'w_recent_vaccine_detail', type: 'text', label: 'ワクチン名と接種日を教えてください',
            showIf: { q: 'w_recent_vaccine', op: 'eq', v: 'あり' },
            help: 'ワクチンの種類によっては接種間隔をあける必要があります' },
          { id: 'w_boshi', type: 'radio', required: true, label: '母子手帳はお持ちいただけますか',
            options: ['持参する','持っていない・忘れた'],
            help: '母子手帳がないと接種できない場合があります',
            urgent: { op: 'eq', v: '持っていない・忘れた', level: 'high', msg: '母子手帳の持参がありません。' } },
        ],
      },
      {
        title: '今日の体調',
        questions: [
          { id: 'w_temp', type: 'temperature', required: true, label: '今日の体温',
            help: 'ご自宅で測ってからお越しください',
            urgent: { op: 'gte', v: 37.5, level: 'high', msg: '37.5℃以上のため、接種を見合わせる場合があります。' } },
          { id: 'w_condition', type: 'radio', required: true, label: '今日の体調はいかがですか',
            options: ['元気で変わりない','少し鼻水やせきがある','具合が悪い'],
            urgent: { op: 'eq', v: '具合が悪い', level: 'high', msg: '体調不良の申告があります。接種可否の確認が必要です。' } },
          { id: 'w_recent_fever', type: 'radio', required: true, label: 'ここ1週間で熱が出ましたか', options: YN },
          { id: 'w_recent_fever_date', type: 'date', label: '熱が下がったのはいつですか',
            showIf: { q: 'w_recent_fever', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: 'これまでの経過',
        questions: [
          { id: 'w_reaction', type: 'radio', required: true,
            label: 'これまでの予防接種で、具合が悪くなったことはありますか', options: YN_UNKNOWN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: '予防接種による副反応歴があります。' } },
          { id: 'w_reaction_detail', type: 'textarea', label: 'どのような症状でしたか',
            placeholder: '例：接種後に高熱が出た', showIf: { q: 'w_reaction', op: 'eq', v: 'あり' } },
          { id: 'w_allergy', type: 'radio', required: true, label: 'アレルギーはありますか', options: YN_UNKNOWN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: 'アレルギーの申告があります。' } },
          { id: 'w_allergy_detail', type: 'textarea', label: '原因と症状を教えてください',
            help: '卵・ゼラチン・抗生物質などもご記入ください', showIf: { q: 'w_allergy', op: 'eq', v: 'あり' } },
          { id: 'w_seizure', type: 'radio', required: true, label: 'けいれんを起こしたことはありますか', options: YN_UNKNOWN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: 'けいれんの既往があります。' } },
          { id: 'w_seizure_detail', type: 'text', label: '最後にけいれんを起こしたのはいつですか',
            showIf: { q: 'w_seizure', op: 'eq', v: 'あり' } },
          { id: 'w_disease', type: 'radio', required: true, label: '治療中の病気はありますか', options: YN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: '基礎疾患があります。' } },
          { id: 'w_disease_detail', type: 'textarea', label: '病名を教えてください',
            showIf: { q: 'w_disease', op: 'eq', v: 'あり' } },
          { id: 'w_meds', type: 'radio', required: true, label: '今飲んでいるお薬はありますか', options: YN },
          { id: 'w_meds_detail', type: 'textarea', label: 'お薬の名前を教えてください',
            showIf: { q: 'w_meds', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: '先生に伝えたいこと',
        questions: [
          { id: 'w_note', type: 'textarea', label: '接種について確認したいことがあればご記入ください' },
        ],
      },
    ],
  },

  /* ========== 健診（要件6-6） ========== */
  checkup: {
    title: '健診',
    sections: [
      {
        title: '健診の種類',
        questions: [
          { id: 'c_type', type: 'select', required: true, summary: '健診', label: '今日受ける健診を選んでください',
            options: ['1か月健診','3〜4か月健診','6〜7か月健診','9〜10か月健診','1歳健診','1歳6か月健診','2歳健診','3歳健診','入園前健診','就学前健診','その他の健診'] },
          { id: 'c_height', type: 'number', label: 'ご自宅で測った身長', unit: 'cm', help: 'わかれば入力してください' },
          { id: 'c_weight', type: 'number', label: 'ご自宅で測った体重', unit: 'kg', help: 'わかれば入力してください' },
        ],
      },
      {
        title: 'ふだんの生活',
        questions: [
          /* 乳児向け：1歳未満の健診でのみ表示 */
          { id: 'c_milk', type: 'radio', label: '授乳・ミルクの様子はいかがですか',
            options: ['よく飲む','ふつう','あまり飲まない'],
            showIf: { q: 'c_type', op: 'in', v: ['1か月健診','3〜4か月健診','6〜7か月健診','9〜10か月健診'] } },
          { id: 'c_babyfood', type: 'radio', label: '離乳食は進んでいますか',
            options: ['順調に進んでいる','あまり食べない','まだ始めていない'],
            showIf: { q: 'c_type', op: 'in', v: ['6〜7か月健診','9〜10か月健診','1歳健診'] } },
          /* 幼児以降向け */
          { id: 'c_meal', type: 'radio', label: '食事の様子はいかがですか',
            options: ['よく食べる','ふつう','好き嫌いが多い','あまり食べない'],
            showIf: { q: 'c_type', op: 'in', v: ['1歳健診','1歳6か月健診','2歳健診','3歳健診','入園前健診','就学前健診','その他の健診'] } },
          { id: 'c_sleep', type: 'radio', required: true, label: '睡眠の様子はいかがですか',
            options: ['よく眠れている','寝つきが悪い','夜中に何度も起きる'] },
          { id: 'c_poop', type: 'radio', required: true, label: '便の様子はいかがですか',
            options: ['毎日出ている','2〜3日に1回','便秘ぎみ','下痢ぎみ'] },
        ],
      },
      {
        title: '発育・発達について',
        desc: '気になることがあれば教えてください',
        questions: [
          { id: 'c_worry_growth', type: 'radio', required: true, label: '身長・体重の伸びで気になることはありますか', options: YN },
          { id: 'c_worry_growth_detail', type: 'textarea', label: '気になることを教えてください',
            showIf: { q: 'c_worry_growth', op: 'eq', v: 'あり' } },
          { id: 'c_worry_motor', type: 'radio', required: true, label: '体の動き・運動の発達で気になることはありますか',
            help: '首すわり、おすわり、歩きはじめ、走る・跳ぶなど', options: YN },
          { id: 'c_worry_motor_detail', type: 'textarea', label: '気になることを教えてください',
            showIf: { q: 'c_worry_motor', op: 'eq', v: 'あり' } },
          { id: 'c_worry_speech', type: 'radio', label: 'ことばの発達で気になることはありますか',
            options: YN, showIf: { q: 'c_type', op: 'in', v: ['1歳健診','1歳6か月健診','2歳健診','3歳健診','入園前健診','就学前健診','その他の健診'] } },
          { id: 'c_worry_speech_detail', type: 'textarea', label: '気になることを教えてください',
            showIf: { q: 'c_worry_speech', op: 'eq', v: 'あり' } },
          { id: 'c_worry_dev', type: 'radio', required: true, label: 'そのほか、発達で気になることはありますか',
            help: '目が合いにくい、呼んでも振り向かない、こだわりが強いなど', options: YN },
          { id: 'c_worry_dev_detail', type: 'textarea', label: '気になることを教えてください',
            showIf: { q: 'c_worry_dev', op: 'eq', v: 'あり' } },
          { id: 'c_worry_school', type: 'radio', label: '園や学校での生活で気になることはありますか',
            options: YN, showIf: { q: 'c_type', op: 'in', v: ['3歳健診','入園前健診','就学前健診','その他の健診'] } },
          { id: 'c_worry_school_detail', type: 'textarea', label: '気になることを教えてください',
            showIf: { q: 'c_worry_school', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: 'アレルギー・お薬',
        questions: [
          { id: 'c_allergy', type: 'radio', required: true, label: 'アレルギーはありますか', options: YN_UNKNOWN,
            urgent: { op: 'eq', v: 'あり', level: 'high', msg: 'アレルギーの申告があります。' } },
          { id: 'c_allergy_detail', type: 'textarea', label: '原因と症状を教えてください',
            showIf: { q: 'c_allergy', op: 'eq', v: 'あり' } },
          { id: 'c_meds', type: 'radio', required: true, label: '今飲んでいるお薬はありますか', options: YN },
          { id: 'c_meds_detail', type: 'textarea', label: 'お薬の名前を教えてください',
            showIf: { q: 'c_meds', op: 'eq', v: 'あり' } },
        ],
      },
      {
        title: '先生に伝えたいこと',
        questions: [
          { id: 'c_note', type: 'textarea', label: '相談したいことがあればご記入ください',
            help: '育児のご相談もお気軽にどうぞ' },
        ],
      },
    ],
  },
};
