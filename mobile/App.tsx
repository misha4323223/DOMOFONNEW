import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LeadsScreen } from "./src/screens/LeadsScreen";
import { LeadFormScreen } from "./src/screens/LeadFormScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { api, type Lead, type LeadCandidate } from "./src/api";
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
  | { name: "review"; candidates: LeadCandidate[]; fullText: string };

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