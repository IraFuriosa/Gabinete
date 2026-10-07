const TOAST_TYPES = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-indigo-600',
};

export function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.className = `${TOAST_TYPES[type] ?? TOAST_TYPES.info} text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg max-w-sm toast-enter`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
