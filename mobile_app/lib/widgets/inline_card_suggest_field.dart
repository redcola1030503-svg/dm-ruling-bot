import 'dart:async';

import 'package:extended_text_field/extended_text_field.dart';
import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/card_suggestion.dart';
import 'card_name_special_text.dart';

/// 質問入力欄そのものでカード名を予測変換する複合フィールド。
///
/// 検索欄を別に設けず、質問文中で《を打った直後からその後ろの文字列を
/// クエリとして扱い、候補をフィールド下に表示する(@メンションと同じ発想)。
/// 検索自体は前方一致優先+部分一致補完(旧検索欄と同じ)なので、
/// 《墓地 と打てば《墓地の儀》のような前方一致だけでなく
/// 《♪面白き こともなき墓地を 面白く》のような部分一致カードも
/// 引き続き候補に出る。《を明示的に打つことをトリガーにしているため、
/// 「相手の」「墓地」のような自然文中のありふれた単語が地の文を書いている
/// だけで検索を発動させてしまう(入力の邪魔になる)ことはない。
class InlineCardSuggestField extends StatefulWidget {
  final ApiClient apiClient;
  final TextEditingController controller;
  final FocusNode? focusNode;
  final int maxLines;
  final bool enabled;
  final InputDecoration decoration;

  const InlineCardSuggestField({
    super.key,
    required this.apiClient,
    required this.controller,
    this.focusNode,
    this.maxLines = 5,
    this.enabled = true,
    required this.decoration,
  });

  @override
  State<InlineCardSuggestField> createState() => _InlineCardSuggestFieldState();
}

class _TokenMatch {
  final int start;
  final String query;

  const _TokenMatch({required this.start, required this.query});
}

class _InlineCardSuggestFieldState extends State<InlineCardSuggestField> {
  Timer? _debounce;
  List<CardSuggestion> _suggestions = [];
  int? _tokenStart;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  /// カーソル直前を後方に走査し、閉じられていない直近の《を探す。
  /// 《の直後からカーソルまでが検索クエリになる。改行を跨ぐ場合や
  /// 《より前に》が見つかった場合(既に閉じられている)はnull。
  _TokenMatch? _findOpenBracketToken(String text, int cursor) {
    if (cursor <= 0 || cursor > text.length) return null;
    for (var i = cursor - 1; i >= 0; i--) {
      final ch = text[i];
      if (ch == '》') return null;
      if (ch == '\n') return null;
      if (ch == '《') {
        return _TokenMatch(start: i, query: text.substring(i + 1, cursor));
      }
    }
    return null;
  }

  void _onChanged(String text) {
    final selection = widget.controller.selection;
    final cursor = selection.isValid ? selection.baseOffset : text.length;
    final token = _findOpenBracketToken(text, cursor);

    _debounce?.cancel();
    if (token == null || token.query.isEmpty) {
      _tokenStart = null;
      if (_suggestions.isNotEmpty) setState(() => _suggestions = []);
      return;
    }

    _tokenStart = token.start;
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      List<CardSuggestion> results;
      try {
        results = await widget.apiClient.suggestCards(token.query);
      } catch (_) {
        results = [];
      }
      if (!mounted) return;
      // デバウンス待ちの間に入力が進んでいたら、この結果は古いので捨てる。
      final current = _findOpenBracketToken(widget.controller.text, widget.controller.selection.baseOffset);
      if (current == null || current.start != token.start || current.query != token.query) return;
      setState(() => _suggestions = results);
    });
  }

  void _select(CardSuggestion suggestion) {
    final tokenStart = _tokenStart;
    if (tokenStart == null) return;
    final text = widget.controller.text;
    final selection = widget.controller.selection;
    final cursor = selection.isValid ? selection.baseOffset : text.length;
    final insertion = '《${suggestion.name}》';
    final newText = text.replaceRange(tokenStart, cursor, insertion);
    widget.controller.value = widget.controller.value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(offset: tokenStart + insertion.length),
    );
    setState(() {
      _suggestions = [];
      _tokenStart = null;
    });
    widget.focusNode?.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExtendedTextField(
          controller: widget.controller,
          focusNode: widget.focusNode,
          maxLines: widget.maxLines,
          enabled: widget.enabled,
          textDirection: TextDirection.ltr,
          specialTextSpanBuilder: QuestionSpecialTextSpanBuilder(),
          onChanged: _onChanged,
          decoration: widget.decoration,
        ),
        if (_suggestions.isNotEmpty)
          Container(
            constraints: const BoxConstraints(maxHeight: 200),
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(4),
            ),
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: _suggestions.length,
              itemBuilder: (context, index) {
                final s = _suggestions[index];
                return ListTile(
                  dense: true,
                  title: Text(s.name),
                  onTap: () => _select(s),
                );
              },
            ),
          ),
      ],
    );
  }
}
