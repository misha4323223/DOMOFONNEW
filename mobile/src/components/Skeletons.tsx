import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors } from "../theme";

/**
 * Пульсирующая серая плашка-скелетон. Используется вместо спиннера:
 * показывает структуру будущего контента и выглядит современно.
 */
export function Skeleton({
  width,
  height,
  radius = 12,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
}) {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.inputBg,
        opacity: pulse,
      }}
    />
  );
}

/** Список карточек-заглушек (заявки, заметки, архив, отзывы). */
export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.row}>
            <Skeleton width="55%" height={16} />
            <Skeleton width={64} height={11} />
          </View>
          <Skeleton width="85%" height={13} />
          <View style={styles.row}>
            <Skeleton width="45%" height={14} />
            <Skeleton width={92} height={20} radius={7} />
          </View>
          <Skeleton width="70%" height={11} />
        </View>
      ))}
    </View>
  );
}

/** Заглушка чата: пузыри сообщений слева и справа. */
export function ChatSkeleton() {
  return (
    <View style={styles.chatList}>
      <View style={[styles.chatRow, styles.chatRowRight]}>
        <Skeleton width="58%" height={42} radius={16} />
      </View>
      <View style={styles.chatRow}>
        <Skeleton width="42%" height={38} radius={16} />
      </View>
      <View style={styles.chatRow}>
        <Skeleton width="72%" height={52} radius={16} />
      </View>
      <View style={[styles.chatRow, styles.chatRowRight]}>
        <Skeleton width="46%" height={36} radius={16} />
      </View>
      <View style={styles.chatRow}>
        <Skeleton width="60%" height={46} radius={16} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    padding: 14,
    gap: 10,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    // Полоски по бокам — как у настоящей карточки заявки
    borderLeftWidth: 4,
    borderLeftColor: "rgba(245,162,11,0.35)",
    borderRightWidth: 4,
    borderRightColor: "rgba(245,162,11,0.35)",
    padding: 12,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chatList: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  chatRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  chatRowRight: {
    justifyContent: "flex-end",
  },
});