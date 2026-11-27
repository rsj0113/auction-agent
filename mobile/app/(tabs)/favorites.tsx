import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';

export default function FavoritesScreen() {
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavorites();

  const renderItem = ({ item }: { item: FeedItem }) => {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
      >
        <Image source={{ uri: item.photo_url }} style={styles.thumb} resizeMode="cover" />

        <View style={styles.infoBox}>
          <View style={styles.topRow}>
            <View
              style={[
                styles.badge,
                item.safety_grade === 'GREEN'
                  ? styles.badgeGreen
                  : item.safety_grade === 'YELLOW'
                  ? styles.badgeYellow
                  : styles.badgeRed,
              ]}
            >
              <Text style={styles.badgeText}>
                {item.safety_grade === 'GREEN' ? '🟢 안심' : item.safety_grade === 'YELLOW' ? '🟡 주의' : '🔴 위험'}
              </Text>
            </View>
            <Text style={styles.dDay}>{item.d_day}</Text>
          </View>

          <Text style={styles.headline} numberOfLines={1}>
            {item.headline}
          </Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{item.min_bid_str}</Text>
            <Text style={styles.gap}>({item.gap_amount_str} 저렴)</Text>
          </View>

          <Text style={styles.loc} numberOfLines={1}>
            {item.location}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.delBtn}
          onPress={() => toggleFavorite(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={{ fontSize: 18 }}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.case_number}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          favorites.length > 0 ? (
            <Text style={styles.headerCount}>
              총 <Text style={{ color: '#2563eb', fontWeight: '800' }}>{favorites.length}건</Text>의 찜한 매물
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>⭐</Text>
            <Text style={styles.emptyTitle}>아직 찜한 매물이 없습니다</Text>
            <Text style={styles.emptySub}>
              ‘오늘의 줍줍’ 피드에서 마음에 드는 매물에 별표(☆)를 눌러보세요.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  headerCount: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 4,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#cbd5e1',
  },
  infoBox: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeGreen: {
    backgroundColor: '#ecfdf5',
  },
  badgeYellow: {
    backgroundColor: '#fefce8',
  },
  badgeRed: {
    backgroundColor: '#fef2f2',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  dDay: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
  },
  headline: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  price: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  gap: {
    fontSize: 11,
    color: '#16a34a',
    fontWeight: '600',
  },
  loc: {
    fontSize: 11,
    color: '#94a3b8',
  },
  delBtn: {
    padding: 6,
  },
  emptyBox: {
    paddingVertical: 100,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
});
