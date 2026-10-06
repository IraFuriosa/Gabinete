import { escapeHtml } from '../utils.js';

// Gerencia anexo de arquivos via Supabase Storage no bucket "anexos".
// Caminhos: contatos/<id>/arquivo e demandas/<id>/arquivo.

export async function loadAttachments(supabase, type, id, listEl) {
    listEl.innerHTML = '<li class="text-xs text-gray-500 dark:text-gray-400">Carregando…</li>';
    const folder = `${type}/${id}`;
    const { data, error } = await supabase.storage.from('anexos').list(folder, { limit: 100 });
    if (error) {
        listEl.innerHTML = `<li class="text-xs text-red-500">Erro: ${escapeHtml(error.message)}</li>`;
        return;
    }
    if (!data || data.length === 0) {
        listEl.innerHTML = '<li class="text-xs text-gray-500 dark:text-gray-400">Nenhum anexo.</li>';
        return;
    }
    listEl.innerHTML = '';
    for (const file of data) {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between text-sm';
        const { data: signed } = await supabase.storage.from('anexos').createSignedUrl(`${folder}/${file.name}`, 3600);
        li.innerHTML = `
            <span class="truncate mr-2">${escapeHtml(file.name)}</span>
            <span class="flex gap-2 shrink-0">
                ${signed ? `<a href="${escapeHtml(signed.signedUrl)}" target="_blank" class="text-indigo-600 dark:text-indigo-400 hover:underline text-xs">Abrir</a>` : ''}
                <button type="button" data-path="${escapeHtml(folder + '/' + file.name)}" class="attachment-delete-btn text-red-600 dark:text-red-400 text-xs">Excluir</button>
            </span>`;
        listEl.appendChild(li);
    }

    listEl.querySelectorAll('.attachment-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const { error: delError } = await supabase.storage.from('anexos').remove([btn.dataset.path]);
            if (delError) {
                alert('Erro ao excluir: ' + delError.message);
            } else {
                await loadAttachments(supabase, type, id, listEl);
            }
        });
    });
}

export async function uploadAttachment(supabase, type, id, file) {
    const folder = `${type}/${id}`;
    const { error } = await supabase.storage.from('anexos').upload(`${folder}/${file.name}`, file, { upsert: true });
    if (error) {
        alert('Erro ao enviar anexo: ' + error.message);
        return false;
    }
    return true;
}
