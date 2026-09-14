# MSN Classic Messenger

Aplicativo de mensagens inspirado no **MSN Messenger 2005/2006**, recriado do zero para smartphones (Android + iOS) com Flutter + backend real-time em Node.js.

## O que está incluído

### Backend (`/backend`)
- Autenticação segura (JWT + bcrypt)
- Lista de contatos com status (online / ocupado / ausente / invisível / offline)
- Mensagem pessoal + foto de perfil (placeholder)
- Adicionar / aceitar contatos
- Conversas 1:1 em tempo real (Socket.io)
- Indicador “está digitando…”
- Histórico de mensagens persistente (arquivo JSON – funciona em qualquer Windows sem Visual Studio)
- Presença online em tempo real

### App Mobile (`/mobile`)
- Visual nostálgico verde (gradientes, lista de contatos clássica)
- Tela de login / registro
- Lista de contatos agrupada por status
- Janela de conversa com balões
- Emoticons nostálgicos + emojis
- Status + mensagem pessoal editáveis
- Busca de contatos
- Tudo adaptado para toque

---

## Como rodar (passo a passo)

### 1. Pré-requisitos

- **Node.js** 18+ (já tem se você tem npm)
- **Flutter** 3.16+ instalado ([flutter.dev](https://flutter.dev))
- Android Studio ou VS Code + extensões Flutter
- (Opcional) Emulador Android ou iPhone Simulator

### 2. Backend

```bash
cd backend
npm install
npm start
```

O servidor sobe em `http://localhost:3000`.

Você verá:

```
╔══════════════════════════════════════════════════════╗
║         MSN Classic Messenger Backend                ║
║         http://localhost:3000                        ║
║         Socket.io ready                              ║
╚══════════════════════════════════════════════════════╝
```

O banco SQLite (`msn.db`) é criado automaticamente na primeira execução.

### 3. App Flutter

```bash
cd mobile
flutter pub get
```

#### Importante – URL do backend

No arquivo `lib/services/auth_service.dart` a URL padrão é:

```dart
static const String baseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:3000', // Android Emulator
);
```

- **Android Emulator**: `http://10.0.2.2:3000` (já está assim)
- **iOS Simulator**: mude para `http://localhost:3000`
- **Dispositivo físico**: use o IP da sua máquina na rede (ex: `http://192.168.1.15:3000`)

Você pode passar na hora de rodar:

```bash
flutter run --dart-define=API_URL=http://SEU_IP:3000
```

### 4. Rodar o app

```bash
# Android
flutter run

# ou especificar dispositivo
flutter devices
flutter run -d <device_id>
```

### 5. Testar com 2 usuários

1. Abra o app → **Criar conta** (ex: `user1@test.com` / senha `123456` / nome “Fulano”)
2. No emulador/dispositivo 2 (ou web se quiser) crie outro usuário (`user2@test.com`)
3. Em um deles: toque no **+** → adicione o e-mail do outro
4. No outro: aceite o contato (aparece em Pendentes)
5. Toque no contato → converse em tempo real!

---

## Estrutura do projeto

```
msn-classic-messenger/
├── backend/
│   ├── package.json
│   ├── server.js          # Tudo do backend (Express + Socket.io + SQLite)
│   └── msn.db             # Criado automaticamente
├── mobile/
│   ├── pubspec.yaml
│   └── lib/
│       ├── main.dart
│       ├── theme/msn_theme.dart
│       ├── models/user.dart
│       ├── services/
│       │   ├── auth_service.dart
│       │   └── socket_service.dart
│       └── screens/
│           ├── login_screen.dart
│           ├── contact_list_screen.dart
│           └── chat_screen.dart
└── README.md
```

---

## Funcionalidades já implementadas

| Feature                      | Status |
|-----------------------------|--------|
| Login / Registro            | ✅     |
| Lista de contatos           | ✅     |
| Status (online/busy/away/invisible/offline) | ✅ |
| Mensagem pessoal            | ✅     |
| Adicionar contato           | ✅     |
| Aceitar contato             | ✅     |
| Chat 1:1 em tempo real      | ✅     |
| Indicador “está digitando”  | ✅     |
| Histórico de mensagens      | ✅     |
| Emoticons nostálgicos       | ✅     |
| Busca de contatos           | ✅     |
| Visual verde clássico       | ✅     |
| Grupos                      | 🔜     |
| Bloqueio completo           | Parcial |
| Push notifications          | 🔜     |
| Sons característicos        | 🔜     |
| Fotos de perfil reais       | 🔜     |

---

## Próximos passos sugeridos

1. Adicionar `assets/sounds/` com os clássicos “nudge” e “message received”
2. Implementar grupos
3. Upload de avatar
4. Push com Firebase
5. Deploy do backend (Railway, Render ou Fly.io) + domínio
6. Gerar APK assinado: `flutter build apk --release`

---

## Gerar APK para testar no celular

```bash
cd mobile
flutter build apk --release --dart-define=API_URL=http://SEU_IP_PUBLICO:3000
```

O arquivo fica em:
`mobile/build/app/outputs/flutter-apk/app-release.apk`

Transfira para o celular e instale (ative “Fontes desconhecidas”).

> **Atenção**: para produção você precisa de um backend com IP/domínio público e HTTPS (wss).

---

## Licença

Projeto educacional / nostálgico. Feito do zero, sem qualquer código proprietário da Microsoft.

Divirta-se revivendo o MSN!  
“brb”, “rsrs”, “vc tá aí?” 😄
