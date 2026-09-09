import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

/** Куда можно перейти из меню. */
export type NavTarget =
  | "leads"
  | "chat"
  | "archive"
  | "notes"
  | "reviews"
  | "content"
  | "scan"
  | "add";

interface Props {
  /** Какой таб сейчас активен (на fullscreen-экранах — null, бар скрыт). */
  active: "leads" | "chat" | "archive" | "more" | null;
  onNavigate: (target: NavTarget) => void;
  onLogout: () => void;
}

/** Пункты шторки «Ещё». */
const MORE_ITEMS: { target: NavTarget; icon: string; label: string }[] = [
  { target: "scan", icon: "📷", label: "Блокнот" },
  { target: "notes", icon: "📝", label: "Заметки" },
  { target: "reviews", icon: "⭐", label: "Отзывы" },
  { target: "content", icon: "🌐", label: "Сайт" },
];

export function BottomNav({ active, onNavigate, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Анимация шторки: подложка плавно темнеет, панель выезжает снизу
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (sheetOpen) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [sheetOpen, anim]);

  const closeSheet = () => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(() => setSheetOpen(false));
  };

  const go = (target: NavTarget) => {
    closeSheet();
    onNavigate(target);
  };

  const tab = (
    target: NavTarget,
    tabKey: "leads" | "chat" | "archive" | "more",
    icon: string,
    label: string,
  ) => {
    const isActive = active === tabKey;
    return (
      <Pressable
        key={tabKey}
        onPress={() => (tabKey === "more" ? setSheetOpen(true) : go(target))}
        style={styles.tab}
        hitSlop={4}
      >
        <View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive]}>
          <Text style={styles.tabIcon}>{icon}</Text>
        </View>
        <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <View
        style={[
          styles.bar,
          { paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        {tab("leads", "leads", "📋", "Заявки")}
        {tab("chat", "chat", "💬", "Чат")}

        {/* Центральная кнопка «+» — новая заявка */}
        <Pressable onPress={() => go("add")} style={styles.fabWrap} hitSlop={4}>
          <View style={styles.fab}>
            <Text style={styles.fabIcon}>+</Text>
          </View>
          <Text style={styles.fabLabel}>Добавить</Text>
        </Pressable>

        {tab("archive", "archive", "🗄", "Архив")}
        {tab("leads", "more", "☰", "Ещё")}
      </View>

      {/* Шторка «Ещё» */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="none"
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetRoot}>
          <Animated.View
            style={[
              styles.sheetBackdrop,
              { opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) },
            ]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [
                  {
                    translateY: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [420, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Ещё</Text>

            <View style={styles.sheetList}>
              {MORE_ITEMS.map((item) => (
                <Pressable
                  key={item.target}
                  onPress={() => go(item.target)}
                  style={({ pressed }) => [
                    styles.sheetItem,
                    pressed && styles.sheetItemPressed,
                  ]}
                >
                  <View style={styles.sheetItemIcon}>
                    <Text style={styles.sheetItemIconText}>{item.icon}</Text>
                  </View>
                  <Text style={styles.sheetItemLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.sheetDivider} />

            <Pressable
              onPress={() => {
                closeSheet();
                onLogout();
              }}
              style={({ pressed }) => [
                styles.sheetItem,
                pressed && styles.sheetItemPressed,
              ]}
            >
              <View style={[styles.sheetItemIcon, styles.logoutIcon]}>
                <Text style={styles.sheetItemIconText}>🚪</Text>
              </View>
              <Text style={styles.logoutLabel}>Выйти</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  tabIconWrap: {
    width: 40,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconWrapActive: {
    backgroundColor: "rgba(245, 162, 11, 0.16)",
  },
  tabIcon: {
    fontSize: 18,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: "800",
  },
  fabWrap: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabIcon: {
    color: colors.primaryForeground,
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 32,
  },
  fabLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardBorder,
    marginBottom: 14,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 6,
  },
  sheetList: {
    gap: 4,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
  },
  sheetItemPressed: {
    backgroundColor: colors.inputBg,
  },
  sheetItemIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetItemIconText: {
    fontSize: 20,
  },
  sheetItemLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  sheetDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 10,
  },
  logoutIcon: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  logoutLabel: {
    color: colors.destructive,
    fontSize: 16,
    fontWeight: "600",
  },
});