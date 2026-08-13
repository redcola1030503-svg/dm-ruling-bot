class Session {
  final String token;
  final String judgeId;
  final String role;

  const Session({required this.token, required this.judgeId, required this.role});

  bool get isAdmin => role == 'admin';

  factory Session.fromLoginResponse(String token, Map<String, dynamic> json) {
    return Session(
      token: token,
      judgeId: json['judgeId'] as String,
      role: json['role'] as String,
    );
  }

  factory Session.fromSessionResponse(String token, Map<String, dynamic> json) {
    return Session(
      token: token,
      judgeId: json['judgeId'] as String,
      role: json['role'] as String,
    );
  }
}
