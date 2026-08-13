import 'package:extended_text_field/extended_text_field.dart';
import 'package:flutter/material.dart';

/// 質問入力欄で《カード名》をメンションのように強調表示し、
/// 1つの塊として扱う(部分編集不可、Backspaceで一括削除)ための特殊テキスト。
class CardNameSpecialText extends SpecialText {
  static const String kStartFlag = '《';
  static const String kEndFlag = '》';

  final int start;

  CardNameSpecialText(TextStyle? textStyle, {required this.start})
      : super(kStartFlag, kEndFlag, textStyle);

  @override
  bool isEnd(String value) => value == endFlag;

  @override
  InlineSpan finishText() {
    final text = toString();
    final style = (textStyle ?? const TextStyle()).copyWith(
      color: Colors.indigo,
      fontWeight: FontWeight.bold,
    );

    return BackgroundTextSpan(
      background: Paint()..color = Colors.indigo.withValues(alpha: 0.12),
      text: text,
      actualText: text,
      start: start,
      // caretは特殊テキスト内に移動できるが、削除は塊単位で行われる
      deleteAll: true,
      style: style,
    );
  }
}

class QuestionSpecialTextSpanBuilder extends SpecialTextSpanBuilder {
  @override
  SpecialText? createSpecialText(
    String flag, {
    TextStyle? textStyle,
    SpecialTextGestureTapCallback? onTap,
    required int index,
  }) {
    if (flag.isEmpty) return null;
    if (isStart(flag, CardNameSpecialText.kStartFlag)) {
      return CardNameSpecialText(
        textStyle,
        start: index - (CardNameSpecialText.kStartFlag.length - 1),
      );
    }
    return null;
  }
}
