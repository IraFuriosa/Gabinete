import { escapeHtml } from './utils.js';
import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';
import { showToast } from './ui/toast.js';
import { loadAttachments, uploadAttachment } from './ui/attachments.js';

// Trata erros do Supabase de forma centralizada, com mensagem amigável.
function handleSupabaseError(error, context) {
    console.error(context, error);
    const msg = (error && error.message) || '';
    if (msg.includes('row-level security')) {
        showToast('Sem permissão: faça login novamente ou contate o administrador.', 'error');
    } else if (msg.includes('JWT') || msg.includes('expired')) {
        showToast('Sessão expirada. Faça login novamente.', 'error');
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        showToast('Sem conexão com o servidor. Verifique sua internet.', 'error');
    } else {
        showToast(`${context}: ${msg || 'erro desconhecido'}`, 'error');
    }
}

window.onload = function () {
    // Configuração do Supabase Client via variáveis de ambiente
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias');
        showToast('Erro de configuração: variáveis de ambiente não definidas', 'error');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Variáveis de Estado encapsuladas
    const state = {
        demandasCache: [],
        contatosCache: [],
        statusChart: null,
        sortColumn: 'updated_at',
        sortDirection: 'desc',
        isAuthenticated: false,
        isLoadingDemandas: false,
        isLoadingContatos: false,
    };

    function showMainApp(userEmail) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        if (userEmail) {
            document.getElementById('userName').textContent = userEmail;
        }
        initializeCharts(); // Inicializa gráficos para evitar erros
        void carregarContatos();
        void carregarDemandas();
    }

    function showLoginScreen() {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }

    // A fonte de verdade é a sessão real do Supabase (JWT persistido pelo
    // próprio SDK). O sessionStorage manual foi removido: qualquer um
    // podia setar isAuthenticated=true no DevTools.
    supabase.auth.getSession().then(({ data: { session } }) => {
        if (session && session.user) {
            state.isAuthenticated = true;
            showMainApp(session.user.email);
        } else {
            state.isAuthenticated = false;
            showLoginScreen();
        }
    });

    // Reage a login/logout/expiração de token em qualquer aba
    supabase.auth.onAuthStateChange((_event, session) => {
        if (session && session.user) {
            if (!state.isAuthenticated) {
                state.isAuthenticated = true;
                showMainApp(session.user.email);
            }
        } else {
            state.isAuthenticated = false;
            state.demandasCache = [];
            state.contatosCache = [];
            showLoginScreen();
        }
    });

    // =========================================================================================
    // FUNÇÕES DE UTILIDADE E INTERAÇÃO
    // =========================================================================================

    // =========================================================================================
    // FUNÇÕES DE EXPORTAÇÃO E IMPORTAÇÃO CSV
    // =========================================================================================

    function exportToCSV(data, filename) {
        if (!data || data.length === 0) {
            showToast('Não há dados para exportar.', 'info');
            return;
        }

        const headers = Object.keys(data[0]);
        // Remove o ID da exportação para evitar confusão na re-importação
        const filteredHeaders = headers.filter((h) => h !== 'ID');

        const csvRows = [filteredHeaders.join(',')]; // Cabeçalho

        for (const row of data) {
            const values = filteredHeaders.map((header) => {
                let value = row[header];
                if (value === null || value === undefined) {
                    value = '';
                } else if (Array.isArray(value)) {
                    // Se for um array (como em 'demanda'), junta com ';' para evitar conflito com a vírgula do CSV
                    value = `"${value.join('; ')}"`;
                } else {
                    const stringValue = String(value);
                    // Se o valor contém vírgula, aspas ou quebra de linha, coloca entre aspas
                    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                        value = `"${stringValue.replace(/"/g, '""')}"`; // Escapa aspas duplas
                    }
                }
                return value;
            });
            csvRows.push(values.join(','));
        }

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });

        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    // Parser CSV robusto que lida com vírgulas dentro de aspas e quebras de linha
    function parseCSV(csvText) {
        const rows = [];
        let currentRow = [];
        let currentValue = '';
        let insideQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (insideQuotes) {
                if (char === '"' && nextChar === '"') {
                    // Escaped quote
                    currentValue += '"';
                    i++; // Skip next quote
                } else if (char === '"') {
                    // End of quoted value
                    insideQuotes = false;
                } else {
                    currentValue += char;
                }
            } else {
                if (char === '"') {
                    // Start of quoted value
                    insideQuotes = true;
                } else if (char === ',') {
                    // End of value
                    currentRow.push(currentValue.trim());
                    currentValue = '';
                } else if (char === '\n' || char === '\r') {
                    // End of row
                    if (char === '\r' && nextChar === '\n') {
                        i++; // Skip \n in \r\n
                    }
                    currentRow.push(currentValue.trim());
                    if (currentRow.some((v) => v !== '')) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentValue = '';
                } else {
                    currentValue += char;
                }
            }
        }

        // Add last row if exists
        if (currentValue || currentRow.length > 0) {
            currentRow.push(currentValue.trim());
            if (currentRow.some((v) => v !== '')) {
                rows.push(currentRow);
            }
        }

        return rows;
    }

    function handleCsvImport(file, tableName, requiredFields, callback) {
        if (!file) return;

        // Get user first
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user) {
                showToast('Você não está autenticado para importar dados.', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = async (event) => {
                const csv = event.target.result;
                const rows = parseCSV(csv);

                if (rows.length < 2) {
                    showToast('O arquivo CSV está vazio ou não contém dados.', 'error');
                    return;
                }

                const headers = rows[0].map((h) => h.trim());
                const dataToInsert = [];

                for (let i = 1; i < rows.length; i++) {
                    const values = rows[i];
                    const obj = { user_id: user.id };

                    for (let j = 0; j < headers.length; j++) {
                        let value = values[j] ? values[j].trim() : '';
                        // Tratamento especial para o campo 'demanda' que pode ser múltiplo
                        if (headers[j] === 'demanda' && value.includes(';')) {
                            obj[headers[j]] = value.split(';').map((s) => s.trim());
                        } else {
                            obj[headers[j]] = value;
                        }
                    }

                    // Validação simples
                    const hasRequired = requiredFields.every((field) => obj[field] && obj[field] !== '');
                    if (hasRequired) {
                        dataToInsert.push(obj);
                    } else {
                        console.warn(`Linha ${i + 1} ignorada por falta de campos obrigatórios.`);
                    }
                }

                if (dataToInsert.length > 0) {
                    const { error } = await supabase.from(tableName).insert(dataToInsert);
                    if (error) {
                        handleSupabaseError(error, 'Falha ao importar dados');
                    } else {
                        showToast(`${dataToInsert.length} registros importados com sucesso!`, 'success');
                        callback(); // Recarrega os dados da tabela
                    }
                } else {
                    showToast('Nenhum registro válido encontrado no arquivo para importação.', 'info');
                }
            };
            reader.onerror = () => {
                showToast('Não foi possível ler o arquivo selecionado.', 'error');
            };
            reader.readAsText(file);
        });
    }

    // NOVO: Função centralizada para lidar com ações (Edição e Exclusão)
    async function handleDemandAction(action, id) {
        if (action === 'edit') {
            // CORREÇÃO: Busca usando o ID real (d.ID), que é o valor em data-id do botão.
            const demanda = state.demandasCache.find((d) => String(d.ID) === id);

            if (demanda) {
                // Chamadas essenciais para garantir que os SELECTs estejam populados antes de abrir
                await loadDemandasOptions();
                populateContactSelect();

                // Configurações e Abertura do Modal
                document.getElementById('demandModalTitle').textContent = `Editar Demanda #${id}`;
                document.getElementById('demandIdToUpdateInput').value = id;

                // Preenchimento dos campos
                // Limpa seleções anteriores e seleciona as opções corretas para multiselect
                const demandValues = Array.isArray(demanda.demanda) ? demanda.demanda.map((v) => v.trim()) : [demanda.demanda.trim()];

                // Limpa o componente customizado e o preenche com os valores existentes
                document.getElementById('demandTagsContainer').innerHTML = '';
                demandValues.forEach((value) => {
                    // Adiciona a tag visual e atualiza o select oculto
                    addDemandTag(value);
                });
                document.getElementById('demandContactNameSelect').value = demanda.contato;
                document.getElementById('demandDescription').value = demanda.descricao;
                document.getElementById('demandStartDate').value = demanda.data_registro || '';
                document.getElementById('demandEndDate').value = demanda.data_conclusao || '';
                document.getElementById('demandFollowUpDate').value = demanda.data_seguimento || '';
                document.getElementById('demandStatus').value = demanda.status;

                document.getElementById('demandModal').classList.remove('hidden');
                document.getElementById('demandAttachmentsSection').classList.remove('hidden');
                document.getElementById('demandAttachmentsHint').classList.add('hidden');
                void loadAttachments(supabase, 'demandas', id, document.getElementById('demandAttachmentsList'));
            } else {
                showToast('Demanda não encontrada para edição.', 'error');
            }
        } else if (action === 'delete') {
            // Abre o modal de confirmação e passa a função de exclusão como callback
            openConfirmationModal(`a demanda #${id}`, async () => {
                const { error } = await supabase.from('Demandas Ativas').delete().eq('ID', id);

                if (error) {
                    console.error('Erro ao excluir demanda:', error);
                    handleSupabaseError(error, 'Erro ao excluir demanda');
                } else {
                    await carregarDemandas();
                    showToast('Demanda excluída com sucesso!', 'success');
                }
            });
        } else {
            console.error(`Ação desconhecida: ${action}`);
        }
    }

    function toggleDarkMode(isDark) {
        if (isDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
        document.getElementById('darkModeToggleSetting').checked = isDark;
    }

    // Aplica o tema salvo ou o padrão do sistema
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialDark = savedTheme === 'dark' || (savedTheme === null && prefersDark);
    toggleDarkMode(initialDark);

    // Funções de Inicialização de Gráficos (Dashboard)
    function initializeCharts() {
        const ctx = document.getElementById('demandasStatusChart').getContext('2d');
        if (state.statusChart) {
            state.statusChart.destroy();
        }
        state.statusChart = new Chart(ctx, {
            type: 'pie',
            data: {
                // Labels atualizadas para refletir os novos status em pt-BR
                labels: ['Em Aberto', 'Em Andamento', 'Concluída', 'Cancelada'],
                datasets: [
                    {
                        data: [0, 0, 0, 0], // Inicializa com 0
                        backgroundColor: ['#ef4444', '#f97316', '#10b981', '#6b7280'], // Vermelho, Laranja, Verde, Cinza
                        hoverOffset: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151',
                        },
                    },
                    title: {
                        display: false,
                    },
                },
            },
        });
    }

    // Função crucial atualizada para contabilizar e exibir as novas métricas
    function formatDemandaDisplay(demandaData) {
        if (typeof demandaData === 'string' && demandaData.startsWith('[')) {
            try {
                const parsed = JSON.parse(demandaData);
                if (Array.isArray(parsed)) {
                    return parsed.join(', ');
                }
            } catch {
                // Not a valid JSON string, return as is
            }
        } else if (Array.isArray(demandaData)) {
            return demandaData.join(', ');
        }
        return demandaData;
    }

    function updateDashboardMetrics() {
        // Métrica 1: Total de Contatos
        const totalContatos = state.contatosCache.length;
        const totalContatosEl = document.getElementById('totalContatos');
        if (totalContatosEl) totalContatosEl.textContent = totalContatos;

        // Métrica 2: Total de Demandas Registradas
        const totalDemandasRegistradas = state.demandasCache.length;
        const totalDemandasRegistradasEl = document.getElementById('totalDemandasRegistradas');
        if (totalDemandasRegistradasEl) totalDemandasRegistradasEl.textContent = totalDemandasRegistradas;

        // Contagem por Status usando o cache de demandas
        const statusCounts = state.demandasCache.reduce((acc, demanda) => {
            // Usa o status exato em pt-BR
            acc[demanda.status] = (acc[demanda.status] || 0) + 1;
            return acc;
        }, {});

        // Métrica 3: Demandas em Aberto (Status: "Em Aberto")
        const emAberto = statusCounts['Em Aberto'] || 0;
        const emAbertoEl = document.getElementById('demandasEmAberto');
        if (emAbertoEl) emAbertoEl.textContent = emAberto;

        // Métrica 4: Demandas em Andamento (Status: "Em Andamento")
        const emAndamento = statusCounts['Em Andamento'] || 0;
        const emAndamentoEl = document.getElementById('demandasEmAndamento');
        if (emAndamentoEl) emAndamentoEl.textContent = emAndamento;

        // Métrica 5: Demandas Concluídas (Status: "Concluída")
        const concluidas = statusCounts['Concluída'] || 0;
        const concluidasEl = document.getElementById('demandasConcluidas');
        if (concluidasEl) concluidasEl.textContent = concluidas;

        // Atualiza o gráfico
        const cancelada = statusCounts['Cancelada'] || 0;
        if (state.statusChart) {
            // A ordem dos dados DEVE corresponder à ordem das labels no initializeCharts
            state.statusChart.data.datasets[0].data = [emAberto, emAndamento, concluidas, cancelada];
            state.statusChart.update();
        }

        // Top 5 Demandas (simplificado: 5 mais recentes)
        const topList = document.getElementById('topDemandasList');
        if (topList) {
            // Verifica se o elemento Top List existe
            topList.innerHTML = '';
            if (state.demandasCache.length === 0) {
                topList.innerHTML = '<li class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm font-medium">Nenhuma demanda ainda.</li>';
            } else {
                // Cria uma cópia do cache e ordena por 'updated_at' (ou 'data_registro' como fallback)
                const sortedDemandas = [...state.demandasCache].sort((a, b) => {
                    const dateA = new Date(a.updated_at || a.data_registro);
                    const dateB = new Date(b.updated_at || b.data_registro);
                    return dateB - dateA; // Ordena do mais recente para o mais antigo
                });

                sortedDemandas.slice(0, 5).forEach((demanda) => {
                    const li = document.createElement('li');
                    li.className = 'p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm font-medium flex justify-between items-center';
                    li.innerHTML = `
                            <span>${escapeHtml(formatDemandaDisplay(demanda.demanda))} (${escapeHtml(demanda.contato)})</span>
                            <span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">${escapeHtml(demanda.status)}</span>
                        `;
                    topList.appendChild(li);
                });
            }
        }

        // --- Próximas Ações (follow-ups) no dashboard ---
        const proximasAcoesList = document.getElementById('proximasAcoesList');
        if (proximasAcoesList) {
            proximasAcoesList.innerHTML = '';
            const acoes = state.demandasCache
                .filter((d) => d.data_seguimento && d.status !== 'Concluída' && d.status !== 'Cancelada')
                .sort((a, b) => new Date(a.data_seguimento) - new Date(b.data_seguimento));

            if (acoes.length === 0) {
                proximasAcoesList.innerHTML = '<li class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm font-medium">Nenhuma ação agendada.</li>';
            } else {
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                acoes.slice(0, 5).forEach((demanda) => {
                    const followUp = new Date(demanda.data_seguimento);
                    const atrasada = followUp < hoje;
                    const li = document.createElement('li');
                    li.className = `p-3 rounded-lg text-sm font-medium flex justify-between items-center ${atrasada ? 'bg-red-50 dark:bg-red-900/30' : 'bg-gray-50 dark:bg-gray-700'}`;
                    li.innerHTML = `
                    <span>${escapeHtml(formatDemandaDisplay(demanda.demanda))} (${escapeHtml(demanda.contato)})</span>
                    <span class="text-xs font-bold ${atrasada ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}">${atrasada ? 'Atrasada · ' : ''}${followUp.toLocaleDateString('pt-BR')}</span>
                `;
                    proximasAcoesList.appendChild(li);
                });
            }
        }
    }

    // --- FILTROS ---

    // Função debounce para otimizar filtros de texto
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Estados dos filtros
    let demandasFilters = {
        contato: '',
        status: '',
    };
    let contatosFilters = {
        nome: '',
        regiao: '',
    };

    // Função para atualizar as opções de filtro de Região em Contatos
    function updateContatosRegiaoFilterOptions() {
        const select = document.getElementById('filterContatosRegiao');
        select.innerHTML = '<option value="">Todas as Regiões</option>'; // Placeholder

        // Extrai regiões únicas do cache de contatos
        const allRegioes = state.contatosCache.map((c) => c.regiao).filter((r) => r && r.trim() !== '');
        const uniqueRegioes = [...new Set(allRegioes)].sort();

        uniqueRegioes.forEach((regiao) => {
            const option = document.createElement('option');
            option.value = regiao;
            option.textContent = regiao;
            select.appendChild(option);
        });
    }

    // Função para atualizar as opções de filtro de Status em Demandas
    function updateDemandasStatusFilterOptions() {
        // As opções padrão já estão no HTML, mas se quiser atualizar com base no cache:
        // const allStatus = demandasCache.map(d => d.status).filter(s => s && s.trim() !== '');
        // const uniqueStatus = [...new Set(allStatus)].sort();
        // select.innerHTML = '<option value="">Todos os Status</option>';
        // uniqueStatus.forEach(status => {
        //     const option = document.createElement('option');
        //     option.value = status;
        //     option.textContent = status;
        //     select.appendChild(option);
        // });
        // Por simplicidade, usaremos as opções fixas no HTML.
    }

    // Função para aplicar o filtro em Demandas
    // Função para atualizar os campos de filtro de Demandas
    function updateDemandasFilterInputs() {
        document.getElementById('filterDemandasContato').value = demandasFilters.contato;
        document.getElementById('filterDemandasStatus').value = demandasFilters.status;
    }

    // Função para aplicar o filtro em Demandas
    function applyDemandasFilter() {
        let filtered = state.demandasCache;

        if (demandasFilters.contato) {
            filtered = filtered.filter((d) => (d.contato || '').toLowerCase().includes(demandasFilters.contato.toLowerCase()));
        }
        if (demandasFilters.status) {
            filtered = filtered.filter((d) => d.status === demandasFilters.status);
        }

        // NEW: Sorting logic is moved here
        const statusOrder = { 'Em Aberto': 1, 'Em Andamento': 2, Concluída: 3, Cancelada: 4 };
        const sortAsc = state.sortDirection === 'asc';

        filtered.sort((a, b) => {
            const orderA = statusOrder[a.status] || 99;
            const orderB = statusOrder[b.status] || 99;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            // Secondary sort (the one user selected)
            const valA = a[state.sortColumn];
            const valB = b[state.sortColumn];

            // Handle null or undefined values
            if (valA == null && valB == null) return 0;
            if (valA == null) return 1; // nulls last
            if (valB == null) return -1;

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });

        // Re-renderiza a tabela com os dados filtrados E ORDENADOS
        renderDemandas(filtered);
        updateDemandasFilterInputs(); // NEW: Update filter input fields
    }

    // Função para aplicar o filtro em Contatos
    // Função para atualizar os campos de filtro de Contatos
    function updateContatosFilterInputs() {
        document.getElementById('filterContatosNome').value = contatosFilters.nome;
        document.getElementById('filterContatosRegiao').value = contatosFilters.regiao;
    }

    // Função para aplicar o filtro em Contatos
    function applyContatosFilter() {
        let filtered = state.contatosCache;

        if (contatosFilters.nome) {
            filtered = filtered.filter((c) => (c.nome || '').toLowerCase().includes(contatosFilters.nome.toLowerCase()));
        }
        if (contatosFilters.regiao) {
            filtered = filtered.filter((c) => c.regiao === contatosFilters.regiao);
        }

        // Re-renderiza a tabela com os dados filtrados
        renderContatos(filtered);
        updateContatosFilterInputs(); // NEW: Update filter input fields
    }

    // Função para renderizar Demandas com filtros aplicados (recebe o array filtrado)
    function renderDemandas(dataToRender = state.demandasCache) {
        const list = document.getElementById('demandasList');
        list.innerHTML = ''; // Limpa a lista atual

        if (dataToRender.length === 0) {
            list.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Nenhuma demanda encontrada.</td></tr>';
            return;
        }

        let separatorAdded = false;
        dataToRender.forEach((demanda, index) => {
            const isInactive = demanda.status === 'Concluída' || demanda.status === 'Cancelada';

            if (isInactive && !separatorAdded) {
                const separatorRow = document.createElement('tr');
                separatorRow.className = 'demand-separator';
                separatorRow.innerHTML = `
                <td colspan="8" class="px-6 py-2 text-center text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/50 sticky top-0 z-[9]">
                    Demandas Inativas
                </td>
            `;
                list.appendChild(separatorRow);
                separatorAdded = true;
            }

            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition duration-150 ease-in-out' + (isInactive ? ' opacity-60' : '');
            row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">${index + 1}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-300">${escapeHtml(formatDemandaDisplay(demanda.demanda))}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-300"><button type="button" data-contato="${escapeHtml(demanda.contato)}" class="demand-contact-btn text-indigo-600 dark:text-indigo-400 hover:underline font-medium text-left">${escapeHtml(demanda.contato)}</button></td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-300">${escapeHtml(demanda.descricao)}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-300">${escapeHtml(demanda.data_registro ? new Date(demanda.data_registro).toLocaleDateString('pt-BR') : '-')}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-300">${escapeHtml(demanda.data_conclusao ? new Date(demanda.data_conclusao).toLocaleDateString('pt-BR') : '-')}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-300">${escapeHtml(demanda.status)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                <button data-id="${escapeHtml(demanda.ID)}" class="edit-demand-btn text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-600 transition">Editar</button>
                <button data-id="${escapeHtml(demanda.ID)}" class="delete-demand-btn text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-600 transition">Excluir</button>
            </td>
        `;
            list.appendChild(row);
        });

        // Adiciona listeners de evento para os botões de edição/exclusão
        document.querySelectorAll('.demand-contact-btn').forEach((button) => {
            button.addEventListener('click', () => {
                openContactDetailsModal(button.dataset.contato);
            });
        });
        document.querySelectorAll('.edit-demand-btn').forEach((button) => {
            button.addEventListener('click', (e) => {
                handleDemandAction('edit', e.target.dataset.id);
            });
        });
        document.querySelectorAll('.delete-demand-btn').forEach((button) => {
            button.addEventListener('click', (e) => {
                handleDemandAction('delete', e.target.dataset.id);
            });
        });
    }

    // Função para renderizar Contatos com filtros aplicados (recebe o array filtrado)
    function renderContatos(dataToRender = state.contatosCache) {
        const list = document.getElementById('contatosList');
        list.innerHTML = ''; // Limpa a lista atual

        if (dataToRender.length === 0) {
            list.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Nenhum contato encontrado.</td></tr>';
            return;
        }

        // O cache original (ou filtrado) já está ordenado pelo mais novo (no carregarContatos)
        dataToRender.forEach((contato, index) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition duration-150 ease-in-out';
            row.innerHTML = `
            <!-- ID Sequencial (índice no array filtrado ou original) -->
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">${index + 1}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escapeHtml(contato.nome)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escapeHtml(contato.telefone || '-')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escapeHtml(contato.regiao || '-')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escapeHtml(contato.endereco || '-')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escapeHtml(contato.cpf || '-')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escapeHtml(contato.cartao_sus || '-')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                <button data-id="${escapeHtml(contato.ID)}" class="edit-contact-btn text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-600 transition">Editar</button>
                <button data-id="${escapeHtml(contato.ID)}" class="delete-contact-btn text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-600 transition">Excluir</button>
            </td>
        `;
            list.appendChild(row);
        });

        // Adiciona listeners de evento para os botões de edição/exclusão
        document.querySelectorAll('.edit-contact-btn').forEach((button) => {
            button.addEventListener('click', (e) => openEditContactModal(e.target.dataset.id));
        });
        document.querySelectorAll('.delete-contact-btn').forEach((button) => {
            button.addEventListener('click', (e) => deleteContact(e.target.dataset.id));
        });
    }

    // --- EVENT LISTENERS PARA FILTROS ---

    // Filtro de texto para Contato (Demandas) com debounce
    const debouncedFilterDemandasContato = debounce(() => {
        demandasFilters.contato = document.getElementById('filterDemandasContato').value.toLowerCase();
        applyDemandasFilter();
    }, 300); // 300ms de delay

    document.getElementById('filterDemandasContato').addEventListener('input', debouncedFilterDemandasContato);

    // Filtro de seleção para Status (Demandas)
    document.getElementById('filterDemandasStatus').addEventListener('change', (e) => {
        demandasFilters.status = e.target.value;
        applyDemandasFilter();
    });

    // Botão Limpar Filtros Demandas
    document.getElementById('clearDemandasFilter').addEventListener('click', () => {
        document.getElementById('filterDemandasContato').value = '';
        document.getElementById('filterDemandasStatus').value = '';
        demandasFilters.contato = '';
        demandasFilters.status = '';
        applyDemandasFilter(); // Re-renderiza sem filtros
    });

    // Event listener for sort dropdown

    // Filtro de texto para Nome (Contatos) com debounce
    const debouncedFilterContatosNome = debounce(() => {
        contatosFilters.nome = document.getElementById('filterContatosNome').value.toLowerCase();
        applyContatosFilter();
    }, 300); // 300ms de delay

    document.getElementById('filterContatosNome').addEventListener('input', debouncedFilterContatosNome);

    // Filtro de seleção para Região (Contatos)
    document.getElementById('filterContatosRegiao').addEventListener('change', (e) => {
        contatosFilters.regiao = e.target.value;
        applyContatosFilter();
    });

    // Botão Limpar Filtros Contatos
    document.getElementById('clearContatosFilter').addEventListener('click', () => {
        document.getElementById('filterContatosNome').value = '';
        document.getElementById('filterContatosRegiao').value = '';
        contatosFilters.nome = '';
        contatosFilters.regiao = '';
        applyContatosFilter(); // Re-renderiza sem filtros
    });

    // --- ATUALIZAR FUNÇÕES DE CARREGAMENTO ---

    // ATUALIZAR carregarDemandas
    async function carregarDemandas() {
        if (!state.isAuthenticated || state.isLoadingDemandas) return;

        state.isLoadingDemandas = true;
        // Sorting is now handled by applyDemandasFilter after fetching
        document.getElementById('demandasList').innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Carregando demandas…</td></tr>';

        try {
            const { data, error } = await supabase.from('Demandas Ativas').select('*');

            if (error) {
                handleSupabaseError(error, 'Erro ao carregar demandas');
            } else {
                state.demandasCache = data;
                // Update UI elements that depend on the full, unfiltered cache
                updateDashboardMetrics();
                updateDemandasStatusFilterOptions();
                loadRegiaoOptions(); // This is for the contact form, but let's keep it here

                // Apply current filters and sort order, then render the table
                applyDemandasFilter();

                // Update sort icons after filters are applied and table is potentially rendered
                updateSortIcons();
            }
        } finally {
            state.isLoadingDemandas = false;
        }
    }

    // ATUALIZAR carregarContatos
    async function carregarContatos() {
        if (!state.isAuthenticated || state.isLoadingContatos) return;

        state.isLoadingContatos = true;
        document.getElementById('contatosList').innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Carregando contatos…</td></tr>';
        try {
            const { data, error } = await supabase
                .from('Contatos')
                .select('ID, nome, telefone, regiao, endereco, user_id, cartao_sus, cpf')
                .order('ID', { ascending: false });
            if (error) {
                handleSupabaseError(error, 'Erro ao carregar contatos');
            } else {
                state.contatosCache = data;
                renderContatos(); // Renderiza com dados frescos
                updateDashboardMetrics(); // Atualiza dashboard
                updateContatosRegiaoFilterOptions(); // Atualiza opções de filtro
                applyContatosFilter(); // Aplica filtros existentes (ou renderiza tudo se nenhum aplicado)
            }
        } finally {
            state.isLoadingContatos = false;
        }
    }

    function populateContactSelect() {
        const select = document.getElementById('demandContactNameSelect');
        select.innerHTML = '<option value="">Selecione um contato</option>';

        state.contatosCache.forEach((contato) => {
            const option = document.createElement('option');
            option.value = contato.nome; // ou contato.ID se quiser usar ID
            option.textContent = contato.nome;
            select.appendChild(option);
        });
    }

    // A nova função loadDemandasOptions() que você precisa para carregar os dados.
    async function loadDemandasOptions() {
        if (!state.isAuthenticated) return;
        const selectElement = document.getElementById('demandTitleSelect');
        selectElement.innerHTML = '<option value="">Carregando opções...</option>'; // Placeholder temporário

        // Busca o ID e o título da Demanda da tabela 'Demandas'
        const { data, error } = await supabase.from('Demandas').select('Demanda');

        if (error) {
            console.error('Erro ao carregar opções de Demandas:', error);
            selectElement.innerHTML = '<option value="">Erro ao carregar</option>';
            return;
        }

        if (!data || data.length === 0) {
            selectElement.innerHTML = '<option value="">Nenhuma demanda encontrada</option>';
            return;
        }

        // Limpa o seletor e adiciona a opção de placeholder
        selectElement.innerHTML = '<option value="">Selecione a Demanda</option>';

        // Percorre todos os itens retornados, sem remover duplicatas
        data.forEach((demanda) => {
            const trimmedDemanda = (demanda.Demanda || '').trim();
            if (!trimmedDemanda) return; // ignora valores nulos/vazios
            const option = document.createElement('option');
            option.value = trimmedDemanda; // Use trimmed value
            option.textContent = trimmedDemanda; // Use trimmed value
            selectElement.appendChild(option);
            // Adiciona ao cache de opções para o componente customizado
            if (!allDemandOptions.includes(trimmedDemanda)) {
                // Use trimmed value
                allDemandOptions.push(trimmedDemanda);
            }
        });
    }

    // ...
    // Outras funções e event listeners
    // ...

    // Event listener para o botão de 'Nova Demanda'.
    document.getElementById('addDemandButton').addEventListener('click', () => {
        resetDemandForm();
        populateContactSelect(); // Garante que os contatos estão no select
        void loadDemandasOptions();
        demandModal.classList.remove('hidden');
        document.getElementById('demandAttachmentsSection').classList.remove('hidden');
        document.getElementById('demandAttachmentsHint').classList.remove('hidden');
        document.getElementById('demandAttachmentsList').innerHTML = '';
    });
    async function loadRegiaoOptions() {
        if (!state.isAuthenticated) return;
        const selectElement = document.getElementById('contactRegion');
        selectElement.innerHTML = '<option value="">Carregando opções...</option>'; // Placeholder temporário

        // Busca todas as demandas para extrair os valores únicos
        const { data, error } = await supabase.from('Regioes').select('regiao');

        selectElement.innerHTML = ''; // Limpa antes de popular

        if (error) {
            console.error('Erro ao carregar opções de Região (Regiões):', error);
            selectElement.innerHTML = '<option value="">Erro ao carregar</option>';
            return;
        }

        if (!data || data.length === 0) {
            selectElement.innerHTML = '<option value="">Nenhuma região ativa</option>';
            return;
        }

        // 1. Extrair os valores da coluna 'regiao' e garantir que não são nulos
        const allRegiaos = data.map((item) => item.regiao).filter(Boolean);

        // 2. Obter valores únicos
        const uniqueRegiaos = [...new Set(allRegiaos)];

        // 3. Adicionar uma opção de placeholder e as opções únicas
        selectElement.innerHTML = '<option value="">Selecione a Região</option>';

        uniqueRegiaos.sort().forEach((regiao) => {
            const option = document.createElement('option');
            option.value = regiao;
            option.textContent = regiao;
            selectElement.appendChild(option);
        });
    }

    function deleteContact(id) {
        const contato = state.contatosCache.find((c) => String(c.ID) === id);
        const nomeContato = contato ? `o contato "${escapeHtml(contato.nome)}"` : `o item #${id}`;

        openConfirmationModal(nomeContato, async () => {
            const { error } = await supabase.from('Contatos').delete().eq('ID', id);

            if (error) {
                console.error('Erro ao excluir contato:', error);
                handleSupabaseError(error, 'Erro ao excluir contato');
            } else {
                await carregarContatos();
                showToast('Contato excluído com sucesso!', 'success');
            }
        });
    }

    // Nova função para gerenciar o modal de confirmação
    function openConfirmationModal(itemName, onConfirmCallback) {
        const modal = document.getElementById('confirmDeleteModal');
        const messageElement = document.getElementById('confirmDeleteMessage');
        const confirmButton = document.getElementById('confirmDeleteButton');
        const cancelButton = document.getElementById('cancelDeleteButton');

        messageElement.textContent = `Você tem certeza que deseja excluir ${itemName}? Esta ação não pode ser desfeita.`;

        // Limpa listeners antigos e define os novos
        const newConfirmButton = confirmButton.cloneNode(true);
        confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);

        newConfirmButton.addEventListener('click', () => {
            onConfirmCallback();
            modal.classList.add('hidden');
        });
        cancelButton.onclick = () => modal.classList.add('hidden');

        modal.classList.remove('hidden');
    }

    // =========================================================================================
    // EVENT LISTENERS E INICIALIZAÇÃO
    // =========================================================================================

    // === Lógica de Login ===
    // === Lógica de Login (Real com Supabase Auth) ===
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const loginMessage = document.getElementById('loginMessage');

        // Limpa mensagens anteriores
        loginMessage.classList.add('hidden');
        loginMessage.textContent = '';

        // Chamar o método signInWithPassword do Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            // Exibe erro de login
            console.error('Erro de Login:', error.message);
            loginMessage.textContent = `Falha no login: ${error.message}`;
            loginMessage.classList.remove('hidden');
        } else if (data.session && data.user) {
            state.isAuthenticated = true;

            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            document.getElementById('userName').textContent = data.user.email; // Melhor usar o email retornado
            // Tenta carregar os dados reais após o login
            initializeCharts();
            await carregarContatos();
            await carregarDemandas();
        } else {
            // Caso de erro inesperado
            loginMessage.textContent = 'Erro desconhecido. Verifique suas credenciais e confirme seu e-mail.';
            loginMessage.classList.remove('hidden');
        }
    });
    // ...

    document.getElementById('logoutButton').addEventListener('click', () => {
        state.isAuthenticated = false;
        void supabase.auth.signOut();

        state.demandasCache = [];
        state.contatosCache = [];
        document.getElementById('loginForm').reset(); // <-- Limpa os campos de email e senha
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    });

    // === Lógica de Dark Mode ===
    document.getElementById('toggleDarkMode').addEventListener('click', () => {
        toggleDarkMode(!document.documentElement.classList.contains('dark'));
        // Re-inicializa o gráfico para atualizar as cores do texto
        initializeCharts();
        updateDashboardMetrics();
    });

    document.getElementById('toggleDarkModeLogin').addEventListener('click', (e) => {
        e.preventDefault();
        toggleDarkMode(!document.documentElement.classList.contains('dark'));
    });

    document.getElementById('darkModeToggleSetting').addEventListener('change', (e) => {
        toggleDarkMode(e.target.checked);
        // Re-inicializa o gráfico para atualizar as cores do texto
        initializeCharts();
        updateDashboardMetrics();
    });

    // === Lógica de Tabs ===
    document.querySelectorAll('.tab-link').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = e.target.closest('.tab-link').dataset.tab;

            document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
            document.getElementById(tabName).classList.add('active');

            document.querySelectorAll('.tab-link').forEach((l) => {
                l.classList.remove('active-tab', 'bg-indigo-50', 'dark:bg-indigo-500/10', 'text-indigo-700', 'dark:text-indigo-300');
                l.classList.add('text-gray-600', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
            });

            const activeLinks = document.querySelectorAll(`.tab-link[data-tab="${tabName}"]`);
            activeLinks.forEach((activeLink) => {
                activeLink.classList.add('active-tab', 'bg-indigo-50', 'dark:bg-indigo-500/10', 'text-indigo-700', 'dark:text-indigo-300');
                activeLink.classList.remove('text-gray-600', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
            });

            const pageTitleText = document.querySelector(`.tab-link[data-tab="${tabName}"]`).textContent.trim();
            document.getElementById('pageTitle').textContent = pageTitleText;

            if (tabName === 'dashboard') {
                // O gráfico já é atualizado ao carregar os dados, mas podemos forçar se necessário
                if (state.statusChart) {
                    state.statusChart.resize();
                } else {
                    initializeCharts();
                    updateDashboardMetrics();
                }
            }
        });
    });

    // === Lógica do Componente Customizado de Multiseleção de Demandas ===
    const customSelect = document.getElementById('customDemandSelect');
    const searchInput = document.getElementById('demandSearchInput');
    const tagsContainer = document.getElementById('demandTagsContainer');
    const optionsDropdown = document.getElementById('demandOptionsDropdown');
    const originalSelect = document.getElementById('demandTitleSelect');

    let allDemandOptions = []; // Cache para todas as opções de demanda

    // Função para adicionar uma tag e atualizar o select original
    function addDemandTag(value) {
        if (!value) return;
        const trimmedValue = value.trim(); // Trim the value

        // Verifica se a tag já existe
        const existingTags = Array.from(tagsContainer.querySelectorAll('.demand-tag')).map((tag) => tag.dataset.value);
        if (existingTags.includes(trimmedValue)) {
            // Use trimmedValue here
            return; // Não adiciona duplicatas
        }

        // Cria a tag visual
        const tag = document.createElement('div');
        tag.className =
            'demand-tag flex items-center bg-indigo-100 dark:bg-indigo-500/30 text-indigo-700 dark:text-indigo-200 text-sm font-medium px-2 py-1 rounded-md';
        tag.dataset.value = trimmedValue; // Use trimmedValue here
        tag.innerHTML = `
                <span>${escapeHtml(trimmedValue)}</span>
                <button type="button" class="ml-2 text-indigo-500 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-100">&times;</button>
            `;
        tagsContainer.appendChild(tag);

        // Adiciona evento para remover a tag
        tag.querySelector('button').addEventListener('click', () => {
            removeDemandTag(trimmedValue); // Use trimmedValue here
        });

        // Atualiza o select original
        const option = Array.from(originalSelect.options).find((opt) => opt.value === trimmedValue); // Use trimmedValue here
        if (option) {
            option.selected = true;
        }

        // Atualiza o dropdown de opções
        renderDemandOptionsDropdown();
    }

    // Função para remover uma tag
    function removeDemandTag(value) {
        // Remove a tag visual
        const tagToRemove = tagsContainer.querySelector(`[data-value="${value}"]`);
        if (tagToRemove) {
            tagToRemove.remove();
        }

        // Desmarca no select original
        const option = Array.from(originalSelect.options).find((opt) => opt.value === value);
        if (option) {
            option.selected = false;
        }

        // Atualiza o dropdown de opções
        renderDemandOptionsDropdown();
    }

    // Função para renderizar o dropdown de opções
    function renderDemandOptionsDropdown() {
        const filterText = searchInput.value.toLowerCase();
        const selectedValues = Array.from(originalSelect.selectedOptions).map((opt) => opt.value);

        optionsDropdown.innerHTML = '';
        const availableOptions = allDemandOptions
            .filter((opt) => !selectedValues.includes(opt)) // Filtra já selecionados
            .filter((opt) => opt.toLowerCase().includes(filterText)); // Filtra por busca

        if (availableOptions.length === 0) {
            optionsDropdown.innerHTML = `<div class="px-4 py-2 text-sm text-gray-500">Nenhuma opção encontrada.</div>`;
        } else {
            availableOptions.forEach((optionValue) => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm';
                optionDiv.textContent = optionValue;
                optionDiv.addEventListener('click', () => {
                    addDemandTag(optionValue);
                    searchInput.value = '';
                    renderDemandOptionsDropdown();
                    optionsDropdown.classList.add('hidden');
                });
                optionsDropdown.appendChild(optionDiv);
            });
        }
    }

    // Eventos para abrir/fechar e filtrar o dropdown
    searchInput.addEventListener('focus', () => {
        renderDemandOptionsDropdown();
        optionsDropdown.classList.remove('hidden');
    });
    searchInput.addEventListener('input', renderDemandOptionsDropdown);

    // Clique na área de tags foca no input de busca
    const demandTagsArea = document.getElementById('demandTagsArea');
    if (demandTagsArea) {
        demandTagsArea.addEventListener('click', () => {
            searchInput.focus();
        });
    }

    document.addEventListener('click', (e) => {
        if (!customSelect.contains(e.target)) {
            optionsDropdown.classList.add('hidden');
        }
    });

    // === Lógica do Modal de Demandas ===

    const demandModal = document.getElementById('demandModal');
    const demandForm = document.getElementById('demandForm');
    const demandModalTitle = document.getElementById('demandModalTitle');
    const demandIdToUpdateInput = document.getElementById('demandIdToUpdateInput');

    function resetDemandForm() {
        demandForm.reset();
        demandModalTitle.textContent = 'Adicionar Nova Demanda';
        demandIdToUpdateInput.value = '';
        // Limpa as tags do componente customizado
        tagsContainer.innerHTML = '';
        // Define a data de registro para hoje ao criar uma nova demanda
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('demandStartDate').value = today;
        document.getElementById('demandEndDate').value = ''; // Limpa a data de conclusão
        document.getElementById('demandFollowUpDate').value = ''; // Limpa a data de seguimento
        Array.from(originalSelect.options).forEach((opt) => (opt.selected = false));
    }

    document.getElementById('demandAttachmentInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        const id = document.getElementById('demandIdToUpdateInput').value;
        if (!file || !id) return;
        const ok = await uploadAttachment(supabase, 'demandas', id, file);
        if (ok) {
            showToast('Anexo enviado com sucesso!', 'success');
            void loadAttachments(supabase, 'demandas', id, document.getElementById('demandAttachmentsList'));
        }
        e.target.value = '';
    });

    document.getElementById('closeDemandModalButton').addEventListener('click', () => demandModal.classList.add('hidden'));

    demandForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const demandId = demandIdToUpdateInput.value;
        const demanda = Array.from(document.getElementById('demandTitleSelect').selectedOptions).map((option) => option.value);
        const contato = document.getElementById('demandContactNameSelect').value;
        const descricao = document.getElementById('demandDescription').value;
        const data_registro = document.getElementById('demandStartDate').value;
        const data_conclusao = document.getElementById('demandEndDate').value || null; // Envia nulo se vazio
        const status = document.getElementById('demandStatus').value;
        const data_seguimento = document.getElementById('demandFollowUpDate').value || null;

        let error;
        let message;

        // Validação para garantir que pelo menos uma demanda foi selecionada
        if (demanda.length === 0) {
            showToast('Por favor, selecione pelo menos uma demanda.', 'info');
            return;
        }

        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            showToast('Você não está autenticado.', 'error');
            return;
        }

        const dataToSave = { demanda, contato, descricao, status, data_registro, data_conclusao, data_seguimento, user_id: user.id };

        if (demandId) {
            // Atualizar
            const { error: updateError } = await supabase.from('Demandas Ativas').update(dataToSave).eq('ID', demandId);
            error = updateError;
            message = 'Demanda atualizada com sucesso!';
        } else {
            // Inserir
            const { error: insertError } = await supabase.from('Demandas Ativas').insert([dataToSave]);
            error = insertError;
            message = 'Demanda adicionada com sucesso!';
        }

        if (error) {
            console.error('Erro ao processar demanda:', error);
            handleSupabaseError(error, 'Erro ao processar demanda');
        } else {
            demandModal.classList.add('hidden');
            resetDemandForm();
            await carregarDemandas();
            showToast(message, 'success');
        }
    });

    // === Lógica de Importação/Exportação ===
    document.getElementById('exportContatosCSV').addEventListener('click', () => {
        exportToCSV(state.contatosCache, 'contatos.csv');
    });

    document.getElementById('importContatosCSV').addEventListener('click', () => {
        document.getElementById('contatosCsvInput').click();
    });

    document.getElementById('contatosCsvInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        handleCsvImport(file, 'Contatos', ['nome'], carregarContatos);
        e.target.value = null; // Reseta o input para permitir selecionar o mesmo arquivo novamente
    });

    document.getElementById('exportDemandasCSV').addEventListener('click', () => {
        exportToCSV(state.demandasCache, 'demandas.csv');
    });

    document.getElementById('importDemandasCSV').addEventListener('click', () => {
        document.getElementById('demandasCsvInput').click();
    });

    document.getElementById('demandasCsvInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        handleCsvImport(file, 'Demandas Ativas', ['demanda', 'contato', 'status'], carregarDemandas);
        e.target.value = null; // Reseta o input
    });

    // === Lógica do Modal de Contatos ===

    const contactModal = document.getElementById('contactModal');
    const contactForm = document.getElementById('contactForm');
    const contactModalTitle = document.getElementById('contactModalTitle');
    const contactIdToUpdateInput = document.getElementById('contactIdToUpdateInput');

    function openContactDetailsModal(contactName) {
        const contato = state.contatosCache.find((c) => c.nome === contactName);
        const content = document.getElementById('contactDetailsContent');
        content.innerHTML = '';

        if (!contato) {
            content.innerHTML = `<div><dt class="font-semibold text-gray-500 dark:text-gray-400">Nome</dt><dd class="text-gray-900 dark:text-gray-100">${escapeHtml(contactName)}</dd><p class="text-xs text-gray-500 dark:text-gray-400">Contato não encontrado no cache local.</p></div>`;
        } else {
            const fields = [
                ['Nome', contato.nome],
                ['Telefone', contato.telefone],
                ['Região', contato.regiao],
                ['Endereço', contato.endereco],
                ['CPF', contato.cpf],
                ['Cartão SUS', contato.cartao_sus],
            ];
            for (const [label, value] of fields) {
                const div = document.createElement('div');
                div.innerHTML = `<dt class="font-semibold text-gray-500 dark:text-gray-400">${escapeHtml(label)}</dt><dd class="text-gray-900 dark:text-gray-100">${value ? escapeHtml(value) : '-'}</dd>`;
                content.appendChild(div);
            }
        }
        document.getElementById('contactDetailsModal').classList.remove('hidden');
    }

    document.getElementById('closeContactDetailsModalButton').addEventListener('click', () => {
        document.getElementById('contactDetailsModal').classList.add('hidden');
    });

    function resetContactForm() {
        contactForm.reset();
        document.getElementById('contactCartaoSus').value = '';
        document.getElementById('contactCpf').value = '';
        contactModalTitle.textContent = 'Adicionar Novo Contato';
        contactIdToUpdateInput.value = '';
    }

    document.getElementById('addContactButton').addEventListener('click', () => {
        resetContactForm();
        contactModal.classList.remove('hidden');
        document.getElementById('contactAttachmentsSection').classList.remove('hidden');
        document.getElementById('contactAttachmentsHint').classList.remove('hidden');
        document.getElementById('contactAttachmentsList').innerHTML = '';
    });

    document.getElementById('contactAttachmentInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        const id = document.getElementById('contactIdToUpdateInput').value;
        if (!file || !id) return;
        const ok = await uploadAttachment(supabase, 'contatos', id, file);
        if (ok) {
            showToast('Anexo enviado com sucesso!', 'success');
            void loadAttachments(supabase, 'contatos', id, document.getElementById('contactAttachmentsList'));
        }
        e.target.value = '';
    });

    document.getElementById('closeContactModalButton').addEventListener('click', () => {
        contactModal.classList.add('hidden');
    });

    function openEditContactModal(id) {
        const contato = state.contatosCache.find((c) => String(c.ID) === id);
        if (contato) {
            contactModalTitle.textContent = `Editar Contato #${id}`;
            contactIdToUpdateInput.value = id;
            document.getElementById('contactName').value = contato.nome;
            document.getElementById('contactPhone').value = contato.telefone || '';
            // O valor deve ser definido diretamente no elemento SELECT
            document.getElementById('contactRegion').value = contato.regiao || '';
            document.getElementById('contactAddress').value = contato.endereco || '';
            document.getElementById('contactCartaoSus').value = contato.cartao_sus || '';
            document.getElementById('contactCpf').value = contato.cpf || '';
            // email e tipo não são exibidos no modal
            contactModal.classList.remove('hidden');
            document.getElementById('contactAttachmentsSection').classList.remove('hidden');
            document.getElementById('contactAttachmentsHint').classList.add('hidden');
            void loadAttachments(supabase, 'contatos', id, document.getElementById('contactAttachmentsList'));
        } else {
            showToast('Contato não encontrado.', 'error');
        }
    }

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const contactId = contactIdToUpdateInput.value;
        const nome = document.getElementById('contactName').value;
        const telefone = document.getElementById('contactPhone').value;
        const regiao = document.getElementById('contactRegion').value;
        const endereco = document.getElementById('contactAddress').value;

        let error;
        let message;

        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            showToast('Você não está autenticado.', 'error');
            return;
        }

        const cartao_sus = document.getElementById('contactCartaoSus').value;
        const cpf = document.getElementById('contactCpf').value;
        const dataToSave = { nome, telefone, regiao, endereco, cartao_sus, cpf, user_id: user.id };

        if (contactId) {
            // Atualizar
            const { error: updateError } = await supabase.from('Contatos').update(dataToSave).eq('ID', contactId);
            error = updateError;
            message = 'Contato atualizado com sucesso!';
        } else {
            // Inserir
            const { error: insertError } = await supabase.from('Contatos').insert([dataToSave]);
            error = insertError;
            message = 'Contato adicionado com sucesso!';
        }

        if (error) {
            console.error('Erro ao processar contato:', error);
            handleSupabaseError(error, 'Erro ao processar contato');
        } else {
            contactModal.classList.add('hidden');
            resetContactForm();
            await carregarContatos();
            showToast(message, 'success');
        }
    });
    //Formatação de exibição de telefone no cadastro de contatos
    //
    const contactPhone = document.getElementById('contactPhone');

    contactPhone.addEventListener('input', function (e) {
        let value = e.target.value.replace(/\D/g, ''); // Remove tudo que não for número

        if (value.length > 11) value = value.slice(0, 11);

        if (value.length > 0) {
            value = value.replace(/^(\d{2})(\d)/g, '($1) $2');
        }
        if (value.length > 9) {
            value = value.replace(/(\d{5})(\d{4})$/, '$1-$2');
        } else if (value.length > 5) {
            value = value.replace(/(\d{4,5})(\d{0,4})$/, '$1-$2');
        }

        e.target.value = value;
    });
    function updateSortIcons() {
        document.querySelectorAll('#demandas th[data-sort]').forEach((header) => {
            const iconSpan = header.querySelector('.sort-icon');
            if (header.dataset.sort === state.sortColumn) {
                if (state.sortDirection === 'asc') {
                    iconSpan.innerHTML = ' &#9650;'; // up arrow
                } else {
                    iconSpan.innerHTML = ' &#9660;'; // down arrow
                }
            } else {
                iconSpan.innerHTML = '';
            }
        });
    }

    document.querySelectorAll('#demandas th[data-sort]').forEach((header) => {
        header.addEventListener('click', () => {
            const newSortColumn = header.dataset.sort;
            if (state.sortColumn === newSortColumn) {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortColumn = newSortColumn;
                state.sortDirection = 'desc';
            }
            // Re-apply filters and sorting without a new network request
            applyDemandasFilter();
            // Update the sort indicator icons
            updateSortIcons();
        });
    });
    function initDoubleScrollbar(wrapperId) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;

        const bottomScrollbar = wrapper.querySelector('.bottom-scrollbar-wrapper');
        const table = wrapper.querySelector('table');
        if (!bottomScrollbar || !table) return;

        const topScrollbarWrapper = document.createElement('div');
        topScrollbarWrapper.style.overflowX = 'auto';
        topScrollbarWrapper.style.overflowY = 'hidden';
        topScrollbarWrapper.classList.add('top-scrollbar-wrapper');

        const topScrollbarInner = document.createElement('div');
        topScrollbarInner.style.height = '1px';

        topScrollbarWrapper.appendChild(topScrollbarInner);
        wrapper.prepend(topScrollbarWrapper);

        function updateWidth() {
            topScrollbarInner.style.width = table.scrollWidth + 'px';
        }

        updateWidth();

        topScrollbarWrapper.addEventListener('scroll', () => {
            bottomScrollbar.scrollLeft = topScrollbarWrapper.scrollLeft;
        });

        bottomScrollbar.addEventListener('scroll', () => {
            topScrollbarWrapper.scrollLeft = bottomScrollbar.scrollLeft;
        });

        window.addEventListener('resize', updateWidth);

        const observer = new MutationObserver(updateWidth);
        observer.observe(table, { childList: true, subtree: true });
    }

    initDoubleScrollbar('demandas-table-wrapper');
    initDoubleScrollbar('contatos-table-wrapper');
};
