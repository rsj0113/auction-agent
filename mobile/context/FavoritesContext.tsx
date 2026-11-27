import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FeedItem } from '../types/feed';

interface FavoritesContextType {
  favorites: FeedItem[];
  isFavorite: (caseNumber: string) => boolean;
  toggleFavorite: (item: FeedItem) => Promise<void>;
}

const STORAGE_KEY = '@easy_auction_favorites_v1';

const FavoritesContext = createContext<FavoritesContextType>({
  favorites: [],
  isFavorite: () => false,
  toggleFavorite: async () => {},
});

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [favorites, setFavorites] = useState<FeedItem[]>([]);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load favorites', e);
    }
  };

  const isFavorite = (caseNumber: string) => {
    return favorites.some((f) => f.case_number === caseNumber);
  };

  const toggleFavorite = async (item: FeedItem) => {
    try {
      let updated: FeedItem[];
      if (isFavorite(item.case_number)) {
        updated = favorites.filter((f) => f.case_number !== item.case_number);
      } else {
        updated = [item, ...favorites];
      }
      setFavorites(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to update favorite', e);
    }
  };

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => useContext(FavoritesContext);
