import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/card_suggestion.dart';

/// カード名を検索し、選択すると《カード名》の形式でコールバックに渡す入力欄。
class CardSuggestField extends StatefulWidget {
  final ApiClient apiClient;
  final void Function(String cardName) onSelected;

  const CardSuggestField({
    super.key,
    required this.apiClient,
    required this.onSelected,
  });

  @override
  State<CardSuggestField> createState() => _CardSuggestFieldState();
}

class _CardSuggestFieldState extends State<CardSuggestField> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<CardSuggestion> _suggestions = [];
  bool _loading = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    // 《零》のような1文字のカード名にも対応するため1文字から検索する。
    if (value.trim().isEmpty) {
      setState(() => _suggestions = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      setState(() => _loading = true);
      try {
        final results = await widget.apiClient.suggestCards(value.trim());
        if (!mounted) return;
        setState(() => _suggestions = results);
      } catch (_) {
        if (!mounted) return;
        setState(() => _suggestions = []);
      } finally {
        if (mounted) setState(() => _loading = false);
      }
    });
  }

  void _select(CardSuggestion suggestion) {
    widget.onSelected(suggestion.name);
    _controller.clear();
    setState(() => _suggestions = []);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _controller,
          onChanged: _onChanged,
          decoration: InputDecoration(
            labelText: 'カード名を検索して挿入',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
            border: const OutlineInputBorder(),
          ),
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
