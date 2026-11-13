import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Edit3,
  Loader2,
  Plus,
  Printer,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  getApiErrorMessage,
  Receipt,
  ReceiptItemUpdatePayload,
  updateReceipt,
  createReceipt,
} from '../services/api';
import { formatCurrency, formatQuantity, RECEIPT_CATEGORIES as DEFAULT_CATEGORIES } from '../lib/format';

import { categoryLabel, t } from '../i18n';
interface ThermalReceiptModalProps {
  isOpen: boolean;
  isAnalyzing: boolean;
  receipt: Receipt | null;
  initialEditMode?: boolean;
  onClose: () => void;
  onSaved: (updated: Receipt) => void;
}


export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  isOpen,
  isAnalyzing,
  receipt,
  initialEditMode = false,
  onClose,
  onSaved,
}) => {
  // 0: beklemede, 1: Mağaza & Tarih basıldı, 2: Ürünler tek tek basılıyor, 3: Çift çizgi + Toplam basıldı
  const [step, setStep] = useState<number>(0);
  const [visibleItemsCount, setVisibleItemsCount] = useState<number>(0);

  // Termal Fiş Üzerinde Doğrudan Düzenleme (Inline Edit) State'leri
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [merchant, setMerchant] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [items, setItems] = useState<ReceiptItemUpdatePayload[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const syncFormFromReceipt = (target: Receipt) => {
    setMerchant(target.merchant);
    setDate(target.date);
    setTotalAmount(target.total_amount);
    setItems(
      target.items.map((item) => {
        const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
        const unitPrice =
          item.unit_price !== null && item.unit_price !== undefined && item.unit_price > 0
            ? item.unit_price
            : Number((item.price / qty).toFixed(2));
        return {
          name: item.name,
          quantity: qty,
          unit_price: unitPrice,
          price: item.price,
          category: item.category,
        };
      })
    );
    setError(null);
  };

  useEffect(() => {
    if (!isOpen || isAnalyzing || !receipt) {
      setStep(0);
      setVisibleItemsCount(0);
      setIsEditing(false);
      setError(null);
      return;
    }

    syncFormFromReceipt(receipt);

    if (initialEditMode) {
      // Tablodan doğrudan "Düzenle" ile açıldıysa animasyon beklemeden tam kağıdı düzenleme modunda aç
      setStep(3);
      setVisibleItemsCount(receipt.items.length);
      setIsEditing(true);
      return;
    }

    setIsEditing(false);
    // Adım 1: Mağaza adı ve tarih belirir
    setStep(1);
    setVisibleItemsCount(0);

    const step2Timer = setTimeout(() => {
      setStep(2);
    }, 300);

    return () => clearTimeout(step2Timer);
  }, [isOpen, isAnalyzing, receipt, initialEditMode]);

  useEffect(() => {
    if (step !== 2 || !receipt || isEditing) return;

    const totalItems = receipt.items.length;
    if (visibleItemsCount < totalItems) {
      const itemTimer = setTimeout(() => {
        setVisibleItemsCount((prev) => prev + 1);
      }, 150);
      return () => clearTimeout(itemTimer);
    } else {
      const step3Timer = setTimeout(() => {
        setStep(3);
      }, 240);
      return () => clearTimeout(step3Timer);
    }
  }, [step, visibleItemsCount, receipt, isEditing]);

  if (!isOpen) return null;

  const recalculateTotal = (updatedItems: ReceiptItemUpdatePayload[]) => {
    const sum = updatedItems.reduce((acc, cur) => acc + (Number(cur.price) || 0), 0);
    setTotalAmount(Number(sum.toFixed(2)));
  };

  const handleItemChange = (
    index: number,
    field: keyof ReceiptItemUpdatePayload,
    value: string | number
  ) => {
    const next = [...items];
    const current = { ...next[index] };

    if (field === 'name' || field === 'category') {
      current[field] = String(value);
    } else if (field === 'quantity') {
      const rawQty = Number(value);
      const qty = rawQty > 0 ? rawQty : 1;
      const prevQty = current.quantity && current.quantity > 0 ? current.quantity : 1;
      const unit =
        current.unit_price !== null && current.unit_price !== undefined && current.unit_price > 0
          ? current.unit_price
          : Number((current.price / prevQty).toFixed(2));
      current.quantity = rawQty;
      current.unit_price = unit;
      if (rawQty > 0) {
        current.price = Number((qty * unit).toFixed(2));
      }
    } else if (field === 'price') {
      const linePrice = Math.max(0, Number(value) || 0);
      current.price = linePrice;
      const qty = current.quantity && current.quantity > 0 ? current.quantity : 1;
      current.unit_price = Number((linePrice / qty).toFixed(2));
    }

    next[index] = current;
    setItems(next);
    recalculateTotal(next);
  };

  const handleAddItem = () => {
    const next: ReceiptItemUpdatePayload[] = [
      ...items,
      {
        name: '',
        quantity: 1,
        unit_price: 0,
        price: 0,
        category: 'Gıda',
      },
    ];
    setItems(next);
  };

  const handleRemoveItem = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    recalculateTotal(next);
  };

  const handleSave = async () => {
    if (!receipt) return;
    if (!merchant.trim()) {
      setError(t("Mağaza adı boş bırakılamaz."));
      return;
    }
    if (!date.trim()) {
      setError(t("Fiş tarihi boş bırakılamaz."));
      return;
    }
    const invalidItem = items.find((i) => !i.name.trim() || !i.category.trim());
    if (invalidItem) {
      setError(t("Lütfen tüm ürünlerin adını girin."));
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const normalizedItems = items.map((i) => {
        const qty = i.quantity && i.quantity > 0 ? Number(i.quantity) : 1;
        const price = Number(i.price) || 0;
        return {
          name: i.name.trim(),
          quantity: qty,
          unit_price: Number((price / qty).toFixed(2)),
          price: Number(price.toFixed(2)),
          category: i.category.trim() || 'Diğer',
        };
      });

      const payload = {
        merchant: merchant.trim(),
        date: date.trim(),
        total_amount: Number(totalAmount),
        items: normalizedItems,
      };
      // id 0: elle eklenen yeni fiş
      const updated = receipt.id === 0 ? await createReceipt(payload) : await updateReceipt(receipt.id, payload);
      onSaved(updated);
    } catch (err) {
      setError(getApiErrorMessage(err, t("Fiş kaydedilirken bir hata oluştu.")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (initialEditMode) {
      onClose();
      return;
    }
    if (receipt) {
      syncFormFromReceipt(receipt);
    }
    setIsEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* Termal Yazıcı Üst Yuvası */}
        <div className="w-full max-w-[410px] h-8 rounded-t-2xl bg-slate-800 border-x border-t border-slate-700 flex items-center justify-between px-4 shadow-inner">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isAnalyzing || (step < 3 && !isEditing)
                  ? 'bg-emerald-400 animate-ping'
                  : isEditing
                  ? 'bg-amber-400'
                  : 'bg-emerald-500'
              }`}
            />
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-300 flex items-center gap-1.5">
              <Printer className="w-3 h-3 text-emerald-400" />
              {isAnalyzing
                ? 'AI OKUYOR...'
                : isEditing
                ? t("DÜZENLEME MODU")
                : step < 3
                ? t("FİŞ BASILIYOR...")
                : t("TERMAL FİŞ ÖZETİ")}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing || isSaving}
            className="text-slate-400 hover:text-white transition disabled:opacity-40"
            title={t("Kapat")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Yazıcı Ağız Yarığı */}
        <div className="w-full max-w-[410px] h-2 bg-slate-950 border-x border-slate-700" />

        {/* Termal Kağıt Gövdesi */}
        <div className="w-full max-w-[392px] transition-all duration-300">
          <div className="thermal-paper px-5 pt-5 pb-6 max-h-[70vh] overflow-y-auto scrollbar-thin">
            {isAnalyzing || !receipt ? (
              /* Gemini AI Analiz Bekleme Durumu */
              <div className="py-10 flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-slate-900/5 border border-slate-300 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-slate-700 animate-spin" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold tracking-widest uppercase text-slate-800">{t("FİŞ GÖRSELİ ÇÖZÜMLENİYOR")}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{t("Gereksiz adres, vergi ve POS detayları eleniyor; ürünler ve fiyatlar çıkarılıyor...")}</p>
                </div>
                <div className="w-full pt-2 space-y-2 opacity-60">
                  <div className="h-2 bg-slate-300/80 rounded animate-pulse w-2/3 mx-auto" />
                  <div className="h-2 bg-slate-300/70 rounded animate-pulse w-1/2 mx-auto" />
                  <div className="border-b border-dashed border-slate-300 my-2" />
                  <div className="h-2 bg-slate-300/60 rounded animate-pulse w-full" />
                  <div className="h-2 bg-slate-300/60 rounded animate-pulse w-5/6" />
                </div>
              </div>
            ) : (
              /* Termal Fiş İçeriği (Görüntüleme veya Doğrudan Kağıt Üzerinde Düzenleme) */
              <div className="space-y-3 text-xs">
                {error && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-400/50 text-rose-800 text-[11px] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* ADIM 1: Mağaza Adı ve Tarih */}
                {step >= 1 && (
                  <div className="animate-thermal-line text-center space-y-1.5 pb-3 border-b border-dashed border-slate-400">
                    <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500">
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      <span>{t("CEBİO OTONOM FİŞ ÖZETİ")}</span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          value={merchant}
                          onChange={(e) => setMerchant(e.target.value)}
                          placeholder={t("MAĞAZA ADI")}
                          className="w-full text-center text-sm font-extrabold uppercase tracking-tight text-slate-900 bg-white/80 border border-dashed border-slate-400 rounded-md px-2 py-1 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500">{t("TARİH:")}</span>
                          <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="text-[11px] font-semibold text-slate-800 bg-white/80 border border-dashed border-slate-400 rounded-md px-2 py-0.5 focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-base font-extrabold tracking-tight text-slate-900 uppercase break-words pt-0.5">
                          {receipt.merchant}
                        </h3>
                        <p className="text-[11px] font-semibold text-slate-600">{t("TARİH:")}{' '}{receipt.date}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* ADIM 2: Ürün Satırları */}
                {step >= 2 && (
                  <div className="space-y-2 py-1">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-dotted border-slate-300 pb-1">
                      <span>{isEditing ? t("ADET / ÜRÜN / KATEGORİ") : t("ÜRÜN DETAYI")}</span>
                      <span>{t("TUTAR")}</span>
                    </div>

                    {isEditing ? (
                      /* Kağıt Üzerinde Doğrudan Düzenlenebilir Ürün Satırları */
                      <div className="space-y-2.5">
                        {items.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-slate-900/[0.03] border border-dashed border-slate-300 space-y-1.5"
                          >
                            <div className="flex items-center gap-1.5">
                              {/* Adet Input */}
                              <div className="flex items-center">
                                <input
                                  type="number"
                                  step="any"
                                  min="0.01"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    handleItemChange(idx, 'quantity', e.target.value)
                                  }
                                  className="w-11 text-center text-xs font-bold text-slate-900 bg-white/90 border border-dashed border-slate-400 rounded px-1 py-1 focus:outline-none focus:border-emerald-600"
                                  title={t("Adet")}
                                />
                                <span className="text-[11px] font-bold text-slate-500 ml-0.5">{t("x")}</span>
                              </div>

                              {/* Ürün Adı Input */}
                              <input
                                type="text"
                                value={item.name}
                                placeholder={t("Ürün adı...")}
                                onChange={(e) =>
                                  handleItemChange(idx, 'name', e.target.value)
                                }
                                className="flex-1 min-w-0 text-xs font-semibold text-slate-900 bg-white/90 border border-dashed border-slate-400 rounded px-2 py-1 focus:outline-none focus:border-emerald-600"
                              />

                              {/* Satır Tutarı Input */}
                              <div className="relative w-20 shrink-0">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.price}
                                  onChange={(e) =>
                                    handleItemChange(idx, 'price', e.target.value)
                                  }
                                  className="w-full text-right text-xs font-bold text-slate-900 bg-white/90 border border-dashed border-slate-400 rounded pl-1.5 pr-4 py-1 focus:outline-none focus:border-emerald-600"
                                  title={t("Satır Tutarı (₺)")}
                                />
                                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 pointer-events-none">
                                  ₺
                                </span>
                              </div>

                              {/* Tek Tıkla Silme İkonu */}
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(idx)}
                                className="p-1 rounded text-rose-600 hover:bg-rose-500/15 transition shrink-0"
                                title={t("Ürünü Sil")}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Alt Satır: Kategori Rozet Seçici & Birim Fiyat Bilgisi */}
                            <div className="flex items-center justify-between gap-2 pl-1">
                              <select
                                value={item.category}
                                onChange={(e) =>
                                  handleItemChange(idx, 'category', e.target.value)
                                }
                                className="text-[10px] font-semibold text-slate-700 bg-white/80 border border-dashed border-slate-400 rounded px-1.5 py-0.5 focus:outline-none focus:border-emerald-600"
                              >
                                {!DEFAULT_CATEGORIES.includes(item.category) &&
                                  item.category && (
                                    <option value={item.category}>{categoryLabel(item.category)}</option>
                                  )}
                                {DEFAULT_CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {categoryLabel(cat)}
                                  </option>
                                ))}
                              </select>

                              {item.quantity > 1 && (
                                <span className="text-[10px] text-slate-500">{t("Birim:")}{' '}{formatCurrency(item.unit_price ?? item.price / item.quantity)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Kağıt Stiline Uygun Minimalist "+ Ürün Ekle" Butonu */}
                        <button
                          type="button"
                          onClick={handleAddItem}
                          className="w-full py-1.5 rounded-lg border border-dashed border-slate-400 hover:border-emerald-600 hover:bg-emerald-500/5 text-[11px] font-bold uppercase tracking-wider text-slate-700 hover:text-emerald-700 flex items-center justify-center gap-1 transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{t("+ Ürün Ekle")}</span>
                        </button>
                      </div>
                    ) : (
                      /* Görüntüleme Modu: Daktilo Efektiyle Basılan Ürün Satırları */
                      receipt.items.slice(0, visibleItemsCount).map((item, idx) => {
                        const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
                        return (
                          <div
                            key={item.id || idx}
                            className="animate-thermal-line py-0.5"
                          >
                            <div className="flex items-baseline justify-between gap-2 text-slate-900">
                              <span className="font-semibold leading-snug break-words">
                                <span className="font-bold text-slate-700">
                                  {formatQuantity(qty)}{t("x")}</span>{' '}
                                {item.name}
                              </span>
                              <span className="flex-1 border-b border-dotted border-slate-400/70 min-w-[16px]" />
                              <span className="font-bold shrink-0">
                                {formatCurrency(item.price)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                              <span>[{categoryLabel(item.category)}]</span>
                              {qty > 1 && item.unit_price ? (
                                <span>{t("Birim:")}{' '}{formatCurrency(item.unit_price)}</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* ADIM 3: Çift Çizgi ve Kalın Puntolu TOPLAM TUTAR */}
                {step >= 3 && (
                  <div className="animate-thermal-line pt-2">
                    <div className="border-t-2 border-b-2 border-double border-slate-800 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm font-black tracking-wider uppercase text-slate-900">{t("TOPLAM TUTAR")}</span>

                      {isEditing ? (
                        <div className="relative w-28">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={totalAmount}
                            onChange={(e) => setTotalAmount(Number(e.target.value))}
                            className="w-full text-right text-sm font-black text-slate-900 bg-white/90 border border-dashed border-slate-500 rounded pl-2 pr-5 py-1 focus:outline-none focus:border-emerald-600"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-black text-slate-700 pointer-events-none">
                            ₺
                          </span>
                        </div>
                      ) : (
                        <span className="text-base font-black text-slate-900">
                          {formatCurrency(receipt.total_amount)}
                        </span>
                      )}
                    </div>
                    <p className="text-center text-[10px] text-slate-500 mt-3 tracking-widest uppercase">
                      {isEditing
                        ? t("*** DEĞİŞİKLİKLERİ KAYDETMEYİ UNUTMAYIN ***")
                        : t("*** HARCAMA KAYDEDİLDİ ***")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Alt Tırtıklı (Sawtooth / Zigzag) Kağıt Kesimi */}
          <div className="thermal-sawtooth-bottom" />
        </div>

        {/* Tırtıklı Kesimin Altındaki Aksiyon Butonları */}
        {!isAnalyzing && receipt && step >= 3 && (
          <div className="animate-thermal-line mt-5 w-full max-w-[392px] grid grid-cols-2 gap-3">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-white/95 hover:bg-white text-slate-800 border border-slate-300 shadow-lg disabled:opacity-50 transition"
                >
                  <X className="w-4 h-4 text-slate-600" />
                  <span>{t("Vazgeç")}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/25 disabled:opacity-50 transition"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t("Değişiklikleri Kaydet")}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    syncFormFromReceipt(receipt);
                    setIsEditing(true);
                  }}
                  className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-white/95 hover:bg-white text-slate-800 border border-slate-300 shadow-lg transition"
                >
                  <Edit3 className="w-4 h-4 text-indigo-600" />
                  <span>{t("Düzenle")}</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/25 transition"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>{t("Kapat / Onayla")}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
