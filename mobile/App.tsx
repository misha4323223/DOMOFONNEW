import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { checkForUpdate, downloadAndRestart } from "./src/updates";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LeadsScreen } from "./src/screens/LeadsScreen";
import { LeadFormScreen } from "./src/screens/LeadFormScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { ContentScreen } from "./src/screens/ContentScreen";
import { NotesScreen } from "./src/screens/NotesScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ReviewsScreen } from "./src/screens/ReviewsScreen";
import { ArchiveScreen } from "./src/screens/ArchiveScreen";
import { api, type Lead, type LeadCandidate } from "./src/api";
import { flushPending } from "./src/sync";
import { colors } from "./src/theme";
import { BottomNav, type NavTarget } from "./src/components/BottomNav";

const TOKEN_KEY = "admin_token";

// Показываем уведомления, когда приложение открыто
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Screen =
  | { name: "leads" }
  | { name: "form"; lead: Lead | null }
  | { name: "scan" }
  | { name: "review"; candidates: LeadCandidate[]; fullText: string }
  | { name: "content" }
  | { name: "notes" }
  | { name: "chat" }
  | { name: "reviews" }
  | { name: "archive" };

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "leads" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        setToken(saved);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // OTA: проверяем наличие новой версии на EAS Update при запуске и при каждом
  // возврате приложения на передний план. Если она есть — скачиваем и сразу
  // перезапускаемся на ней. Автопроверка библиотеки выключена в app.json
  // (updates.checkAutomatically: "NEVER"), чтобы не дублировать запросы.
  const checkingUpdate = useRef(false);
  useEffect(() => {
    const applyUpdateIfAny = async () => {
      if (checkingUpdate.current) return;
      checkingUpdate.current = true;
      try {
        const status = await checkForUpdate();
        if (status === "available") {
          await downloadAndRestart();
        }
      } finally {
        checkingUpdate.current = false;
      }
    };

    if (AppState.currentState === "active") {
      applyUpdateIfAny();
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") applyUpdateIfAny();
    });
    return () => sub.remove();
  }, []);

  // Push-уведомления: тап по «Новый отзыв» открывает модерацию отзывов,
  // тап по «Новое сообщение» — чат, тап по «Новая заявка» — список заявок.
  useEffect(() => {
    if (!token) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content
        .data as { screen?: string } | null;
      if (data?.screen === "reviews") {
        setScreen({ name: "reviews" });
      } else if (data?.screen === "chat") {
        setScreen({ name: "chat" });
      } else if (data?.screen === "leads") {
        setScreen({ name: "leads" });
      }
    });
    return () => sub.remove();
  }, [token]);

  // Офлайн-очередь: отправляем накопленные изменения при входе, при возврате
  // приложения на передний план и каждые 20 секунд — пока есть токен.
  useEffect(() => {
    if (!token) return;
    flushPending(token);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") flushPending(token);
    });
    const interval = setInterval(() => flushPending(token), 20_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [token]);

  const handleLogin = async (newToken: string) => {
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setScreen({ name: "leads" });
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setScreen({ name: "leads" });
  };

  // Нижний таб-бар виден на основных экранах; fullscreen-экраны
  // (форма, блокнот, разбор распознанного) открываются поверх без бара.
  const showNav =
    screen.name === "leads" ||
    screen.name === "chat" ||
    screen.name === "archive" ||
    screen.name === "notes" ||
    screen.name === "reviews" ||
    screen.name === "content";
  const activeTab =
    screen.name === "leads"
      ? ("leads" as const)
      : screen.name === "chat"
        ? ("chat" as const)
        : screen.name === "archive"
          ? ("archive" as const)
          : ("more" as const);

  const handleNavigate = (target: NavTarget) => {
    switch (target) {
      case "add":
        setScreen({ name: "form", lead: null });
        break;
      case "scan":
        setScreen({ name: "scan" });
        break;
      case "chat":
        setScreen({ name: "chat" });
        break;
      case "archive":
        setScreen({ name: "archive" });
        break;
      case "notes":
        setScreen({ name: "notes" });
        break;
      case "reviews":
        setScreen({ name: "reviews" });
        break;
      case "content":
        setScreen({ name: "content" });
        break;
      default:
        setScreen({ name: "leads" });
    }
  };

  let content: ReactNode;
  if (loading) {
    content = (
      <View style={styles.center}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  } else if (!token) {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <LoginScreen onLogin={handleLogin} />
      </View>
    );
  } else if (screen.name === "form") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <LeadFormScreen
          token={token}
          lead={screen.lead}
          onSaved={() => {
            setReloadKey((k) => k + 1);
            setScreen({ name: "leads" });
          }}
          onBack={() => {
            // Перезагружаем список: в форме могли добавить привязанную заметку
            setReloadKey((k) => k + 1);
            setScreen({ name: "leads" });
          }}
        />
      </View>
    );
  } else if (screen.name === "scan") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ScanScreen
          token={token}
          onResult={(candidates, fullText) =>
            setScreen({ name: "review", candidates, fullText })
          }
          onBack={() => setScreen({ name: "leads" })}
        />
      </View>
    );
  } else if (screen.name === "content") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ContentScreen token={token} onBack={() => setScreen({ name: "leads" })} />
      </View>
    );
  } else if (screen.name === "notes") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <NotesScreen token={token} onBack={() => setScreen({ name: "leads" })} />
      </View>
    );
  } else if (screen.name === "chat") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ChatScreen token={token} onBack={() => setScreen({ name: "leads" })} />
      </View>
    );
  } else if (screen.name === "reviews") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ReviewsScreen token={token} onBack={() => setScreen({ name: "leads" })} />
      </View>
    );
  } else if (screen.name === "archive") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ArchiveScreen
          token={token}
          // Перезагружаем список заявок: из архива могли вернуть заявку обратно
          onBack={() => {
            setReloadKey((k) => k + 1);
            setScreen({ name: "leads" });
          }}
        />
      </View>
    );
  } else if (screen.name === "review") {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ReviewScreen
          token={token}
          candidates={screen.candidates}
          fullText={screen.fullText}
          onDone={() => {
            setReloadKey((k) => k + 1);
            setScreen({ name: "leads" });
          }}
          onBack={() => setScreen({ name: "leads" })}
        />
      </View>
    );
  } else {
    content = (
      <View style={styles.root}>
        <StatusBar style="light" />
        <LeadsScreen
          key={reloadKey}
          token={token}
          onEdit={(lead) => setScreen({ name: "form", lead })}
        />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {content}
        {showNav && (
          <BottomNav
            active={activeTab}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});