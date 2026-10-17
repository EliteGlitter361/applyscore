/** Vue 3 page controller — student.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

    const token = localStorage.getItem('adminToken');
    const user = JSON.parse(localStorage.getItem('adminUser') || '{}');
    if (user.role === 'system') {
      // 系统管理已统一放到 Vue 侧边栏，不再依赖旧版跨页按钮。
    }

    let students = [];

    function escapeHtml(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

    async function loadStudents() {
      try {
        const res = await fetch('/api/students', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('获取失败');
        students = await res.json();
        renderTable();
      } catch(e) {
        document.getElementById('studentTableBody').innerHTML = `<tr><td colspan="3" class="empty">加载失败：${escapeHtml(e.message)}</td></tr>`;
      }
    }

    function renderTable() {
      const tbody = document.getElementById('studentTableBody');
      const empty = document.getElementById('emptyState');
      if (students.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        document.getElementById('selectAll').checked = false;
        document.getElementById('selectAllTable').checked = false;
        updateSelectedCount();
        return;
      }
      empty.style.display = 'none';
      tbody.innerHTML = students.map((s, idx) => `
        <tr>
          <td><input type="checkbox" class="checkbox student-checkbox" value="${s.studentId}" onchange="updateSelectedCount()" /></td>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.studentId)}</td>
        </tr>
      `).join('');
      document.getElementById('selectAll').checked = false;
      document.getElementById('selectAllTable').checked = false;
      updateSelectedCount();
    }

    function toggleAll() {
      const checked = document.getElementById('selectAll').checked || document.getElementById('selectAllTable').checked;
      document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checked);
      updateSelectedCount();
    }

    function updateSelectedCount() {
      const checked = document.querySelectorAll('.student-checkbox:checked').length;
      document.getElementById('selectedCount').textContent = checked;
      const total = document.querySelectorAll('.student-checkbox').length;
      const allChecked = total > 0 && checked === total;
      document.getElementById('selectAll').checked = allChecked;
      document.getElementById('selectAllTable').checked = allChecked;
    }

    async function addStudent() {
      const name = document.getElementById('newName').value.trim();
      const studentId = document.getElementById('newStudentId').value.trim();
      if (!name || !studentId) {
        showAlert('提示', '请填写完整');
        return;
      }
      try {
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name, studentId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '添加失败');
        showAlert('成功', '添加成功');
        document.getElementById('newName').value = '';
        document.getElementById('newStudentId').value = '';
        loadStudents();
      } catch(e) {
        showAlert('错误', e.message);
      }
    }

    async function deleteSelected() {
      const checked = document.querySelectorAll('.student-checkbox:checked');
      if (checked.length === 0) {
        showAlert('提示', '请至少选择一个学生');
        return;
      }
      showConfirm('确认删除', `确定要删除选中的 ${checked.length} 名学生吗？`, '确定', '取消', async function(confirmed) {
        if (!confirmed) return;
        const studentIds = Array.from(checked).map(cb => cb.value);
        try {
          for (const id of studentIds) {
            await fetch('/api/students', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ studentId: id })
            });
          }
          loadStudents();
        } catch(e) {
          showAlert('网络错误', '请重试');
        }
      });
    }

    // ===== 导入学生（优化：串行、显示进度） =====
    async function importStudents() {
      const fileInput = document.getElementById('fileInput');
      const file = fileInput.files[0];
      if (!file) {
        showAlert('提示', '请选择文件');
        return;
      }

      const progressContainer = document.getElementById('importProgress');
      const progressFill = document.getElementById('importProgressFill');
      const progressText = document.getElementById('importProgressText');
      const resultEl = document.getElementById('importResult');

      progressContainer.style.display = 'block';
      progressFill.style.width = '0%';
      progressText.textContent = '0%';
      resultEl.textContent = '正在解析文件...';

      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet);
          const headers = Object.keys(jsonData[0] || {});
          const nameKey = headers.find(h => /姓名|name/i.test(h));
          const idKey = headers.find(h => /学号|studentid/i.test(h));
          if (!nameKey || !idKey) {
            showAlert('格式错误', '未找到“姓名”和“学号”列，请检查文件格式。');
            progressContainer.style.display = 'none';
            return;
          }
          const studentsToAdd = jsonData.map(row => ({
            name: String(row[nameKey]).trim(),
            studentId: String(row[idKey]).trim()
          })).filter(s => s.name && s.studentId);
          if (studentsToAdd.length === 0) {
            showAlert('提示', '没有有效数据');
            progressContainer.style.display = 'none';
            return;
          }

          resultEl.textContent = `共 ${studentsToAdd.length} 条，开始导入...`;
          let success = 0, fail = 0;
          const total = studentsToAdd.length;

          for (let i = 0; i < total; i++) {
            const s = studentsToAdd[i];
            try {
              const res = await fetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: s.name, studentId: s.studentId })
              });
              if (res.ok) {
                success++;
              } else {
                const err = await res.json();
                console.warn('导入失败:', s.studentId, err.error);
                fail++;
              }
            } catch (err) {
              console.warn('网络错误:', s.studentId, err);
              fail++;
            }
            const percent = Math.round(((i + 1) / total) * 100);
            progressFill.style.width = percent + '%';
            progressText.textContent = `${percent}% (${i + 1}/${total})`;
          }

          resultEl.textContent = `导入完成：成功 ${success} 条，失败 ${fail} 条`;
          progressFill.style.width = '100%';
          progressText.textContent = `100% (${total}/${total})`;
          setTimeout(() => {
            progressContainer.style.display = 'none';
          }, 3000);
          loadStudents();
        } catch(err) {
          showAlert('解析失败', err.message);
          progressContainer.style.display = 'none';
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function logout() {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      window.location.href = '/login.html';
    }

    loadStudents();
  
    window.escapeHtml = escapeHtml;
    window.loadStudents = loadStudents;
    window.renderTable = renderTable;
    window.toggleAll = toggleAll;
    window.updateSelectedCount = updateSelectedCount;
    window.addStudent = addStudent;
    window.deleteSelected = deleteSelected;
    window.importStudents = importStudents;
    window.logout = logout;

}
