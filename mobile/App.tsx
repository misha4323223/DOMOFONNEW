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
import { api, type Lead, type LeadCandidate } from "./src/api";
import { flushPending } from "./src/sync";
import { colors } from "./src/theme";

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
  | { name: "chat" };

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
          onBack={() => setScreen({ name: "leads" })}
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
          onLogout={handleLogout}
          onAdd={() => setScreen({ name: "form", lead: null })}
          onEdit={(lead) => setScreen({ name: "form", lead })}
          onScan={() => setScreen({ name: "scan" })}
          onContent={() => setScreen({ name: "content" })}
          onNotes={() => setScreen({ name: "notes" })}
          onChat={() => setScreen({ name: "chat" })}
        />
      </View>
    );
  }

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
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