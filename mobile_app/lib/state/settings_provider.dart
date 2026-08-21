import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../theme/accent_colors.dart';

class SettingsProvider extends ChangeNotifier {
  static const _themeModeKey = 'theme_mode';
  static const _accentColorKey = 'accent_color';
  static const _textScaleKey = 'text_scale';
  static const double minTextScale = 0.85;
  static const double maxTextScale = 1.4;

  final FlutterSecureStorage _storage;

  ThemeMode _themeMode = ThemeMode.system;
  Color _accentColor = kAccentColorOptions.first.color;
  double _textScale = 1.0;

  SettingsProvider({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  ThemeMode get themeMode => _themeMode;
  Color get accentColor => _accentColor;
  double get textScale => _textScale;

  Future<void> restore() async {
    try {
      final modeValue = await _storage.read(key: _themeModeKey);
      _themeMode = _parseThemeMode(modeValue);
    } catch (_) {}
    try {
      final colorValue = await _storage.read(key: _accentColorKey);
      final argb = colorValue != null ? int.tryParse(colorValue) : null;
      if (argb != null) {
        _accentColor = Color(argb);
      }
    } catch (_) {}
    try {
      final scaleValue = await _storage.read(key: _textScaleKey);
      final scale = scaleValue != null ? double.tryParse(scaleValue) : null;
      if (scale != null) {
        _textScale = scale.clamp(minTextScale, maxTextScale);
      }
    } catch (_) {}
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    _themeMode = mode;
    notifyListeners();
    try {
      await _storage.write(key: _themeModeKey, value: mode.name);
    } catch (_) {}
  }

  Future<void> setAccentColor(Color color) async {
    _accentColor = color;
    notifyListeners();
    try {
      await _storage.write(
        key: _accentColorKey,
        value: color.toARGB32().toString(),
      );
    } catch (_) {}
  }

  Future<void> setTextScale(double scale) async {
    _textScale = scale.clamp(minTextScale, maxTextScale);
    notifyListeners();
    try {
      await _storage.write(key: _textScaleKey, value: _textScale.toString());
    } catch (_) {}
  }

  ThemeMode _parseThemeMode(String? value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }
}
