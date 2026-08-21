import 'dart:ui' as ui;

import 'package:extended_text_field/extended_text_field.dart';
import 'package:flutter/material.dart';

/// 質問入力欄で《カード名》をメンションのように強調表示し、
/// 1つの塊として扱う(部分編集不可、Backspaceで一括削除)ための特殊テキスト。
///
/// [BackgroundTextSpan]はExtendedTextField(編集可能なフィールド)では
/// 背景描画が反映されない既知の制限があるため
/// (https://github.com/fluttercandies/extended_text_field/issues/215)、
/// 実際のWidgetを埋め込める[ExtendedWidgetSpan]を使う。
class CardNameSpecialText extends SpecialText {
  static const String kStartFlag = '《';
  static const String kEndFlag = '》';

  final int start;
  final Color badgeColor;
  final Color badgeTextColor;

  CardNameSpecialText(
    TextStyle? textStyle, {
    required this.start,
    required this.badgeColor,
    required this.badgeTextColor,
  }) : super(kStartFlag, kEndFlag, textStyle);

  // isEndはデフォルト実装(value.endsWith(endFlag))のままでよい。
  // 独自に上書きすると蓄積文字列全体と終了フラグの完全一致を求めてしまい、
  // 終了フラグが永久に検出されなくなる(実際に発生していたバグ)。

  @override
  InlineSpan finishText() {
    // actualText(コピー・API送信用)は《》を含む正式な形を維持し、
    // バッジ内の表示だけ《》を外したカード名にする。
    final text = toString();
    final displayName = getContent();
    final style = (textStyle ?? const TextStyle()).copyWith(
      color: badgeTextColor,
      fontWeight: FontWeight.w600,
    );

    return ExtendedWidgetSpan(
      actualText: text,
      start: start,
      alignment: ui.PlaceholderAlignment.middle,
      // caretは特殊テキスト内に移動できるが、削除は塊単位で行われる
      deleteAll: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          color: badgeColor,
          borderRadius: BorderRadius.circular(999),
        ),
        // 「破壊の赤！スクラッパーレッド！」のような非常に長いカード名でも
        // 入力欄の枠をはみ出さないよう、一定幅で1行に収め省略表示する。
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 160),
          child: Text(
            displayName,
            style: style,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}

class QuestionSpecialTextSpanBuilder extends SpecialTextSpanBuilder {
  final Color badgeColor;
  final Color badgeTextColor;

  QuestionSpecialTextSpanBuilder({
    required this.badgeColor,
    required this.badgeTextColor,
  });

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
        badgeColor: badgeColor,
        badgeTextColor: badgeTextColor,
      );
    }
    return null;
  }
}
