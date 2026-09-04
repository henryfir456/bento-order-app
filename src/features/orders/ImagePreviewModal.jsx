import Modal from '../../components/Modal';

export default function ImagePreviewModal({ imagePreview, onClose }) {
  return (
    <Modal
      open={Boolean(imagePreview)}
      title={imagePreview?.alt || '餐點圖片'}
      onClose={onClose}
      ariaLabel="關閉餐點圖片預覽"
      className="max-w-3xl"
    >
      {imagePreview && (
        <img
          src={imagePreview.imageUrl}
          alt={imagePreview.alt}
          className="max-h-[70vh] w-full rounded-2xl object-contain"
        />
      )}
    </Modal>
  );
}
