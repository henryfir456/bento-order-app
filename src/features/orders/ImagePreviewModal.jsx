import { useState } from 'react';
import Modal from '../../components/Modal';

export default function ImagePreviewModal({ imagePreview, onClose }) {
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const imageFailed = failedImageUrl === imagePreview?.imageUrl;
  return (
    <Modal
      open={Boolean(imagePreview)}
      title={imagePreview?.alt || '餐點圖片'}
      onClose={onClose}
      ariaLabel="關閉餐點圖片預覽"
      className="max-w-3xl"
    >
      {imagePreview && (imageFailed ? (
        <p role="status" className="py-8 text-center text-sm text-gray-500">圖片載入失敗，請稍後再試。</p>
      ) : (
        <img
          src={imagePreview.imageUrl}
          alt={imagePreview.alt}
          onError={() => setFailedImageUrl(imagePreview.imageUrl)}
          className="mx-auto max-h-[70vh] max-w-full rounded-2xl object-contain"
        />
      ))}
    </Modal>
  );
}
