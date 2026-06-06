# iOS preview 音声 prewarm メモ

- 症状:
  - iPhone で BGM を追加すると、preview で BGM と元動画音声がどちらも無音になりやすい
- 原因:
  - iOS Safari preview は単一音源・音量 1 倍の間だけ native fallback を使う
  - BGM 追加で複数音源になると WebAudio mix に切り替わるが、`MediaElementAudioSourceNode` の作成が再生開始後の `renderFrame()` まで遅れると、route 再初期化済みの `AudioContext` に後付けされた node が無音になりやすい
- 対策:
  - preview 開始前に、その時刻で可聴な動画音声 / BGM / ナレーションを集める
  - `getPreviewAudioRoutingPlan()` で全候補の出力モードをまとめて判定し、WebAudio が必要な候補だけ `ensureAudioNodeForElement()` で先に node 化する
  - node 作成後にだけ iOS Safari preview 専用の audio route 再初期化を走らせる
- 注意:
  - この処理は iOS preview 経路に閉じる。PC / Android / export の共有経路には混ぜない
  - 「BGM を足した瞬間だけ iPhone preview が無音」のような症状は、mute 状態だけでなく node 作成タイミングも優先して確認する
