import { useState, useEffect, useRef } from 'react'
import { formatCurrency } from '../../utils/format'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { parseDateOnly } from '../../utils/date'
import {
  getServiceProviders,
  createServiceProvider,
  updateServiceProvider,
  deleteServiceProvider
} from '../../services/salaries/serviceProviderService'
import { providerCostForMonth } from '../../services/salaries/serviceProviderCalc'
import { useAuth } from '../../context/AuthContext'
import MonthNavigator from '../../components/ui/MonthNavigator'
import {
  Plus,
  Trash,
  Edit,
  ExpandLines,
  CompressLines,
  InfoCircle
} from 'iconoir-react'
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getExpensesByMonth,
  createExpense,
  updateExpense,
  deleteExpense,
  getExtraordinaryByMonth,
  createExtraordinary,
  updateExtraordinary,
  deleteExtraordinary,
  getSetting,
  setSetting,
  contingencyLimit,
  getFixedExpenses,
  createFixedExpense,
  updateFixedExpense,
  deleteFixedExpense,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  PERIODICITY_OPTIONS,
  periodicityLabel,
  monthlyAmount,
  hitsMonth,
  nextPayment,
  fixedCashForMonth,
  fixedMonthlyForMonth,
  getEmployees,
  getStandaloneExtraCosts,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  addSalaryAdjustment,
  updateSalaryAdjustment,
  deleteSalaryAdjustment,
  addExtraCost,
  deleteExtraCost,
  EXTRA_COST_TYPES,
  extraCostLabel
} from '../../services/api'
import { currentSalary, monthlyCostBreakdown, extraordinarios12m } from '../../services/salaries/salaryCalc'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import Input, { Textarea, Checkbox } from '../../components/ui/Input'
import { filterItems, groupByCategory } from '../../services/costs/costsFilters'
import CostsFilterBar from './CostsFilterBar'
import CategoryGroup from './CategoryGroup'
import ContingencyFundBar from './ContingencyFundBar'

export default function CostsPage() {
  const { hasAccess } = useAuth()
  const [suppliers, setSuppliers] = useState([])
  const [serviceProviders, setServiceProviders] = useState([])
  const [providerModal, setProviderModal] = useState({ open: false, provider: null })
  const [expenses, setExpenses] = useState([])
  const [fixedExpenses, setFixedExpenses] = useState([])
  const [categories, setCategories] = useState([])
  const [employees, setEmployees] = useState([])
  const [standaloneCosts, setStandaloneCosts] = useState([])
  const [extraordinaryExpenses, setExtraordinaryExpenses] = useState([])
  const [contingencyPct, setContingencyPct] = useState(10)
  const [loading, setLoading] = useState(true)

  const emptyFilters = { query: '', categoryId: '', supplierId: '', minAmount: '', maxAmount: '' }
  const [variableFilters, setVariableFilters] = useState(emptyFilters)
  const [fixedFilters, setFixedFilters] = useState(emptyFilters)
  // Bulk expand/collapse-all toggle per section. `version` bumps on each click so
  // CategoryGroup instances re-sync to `open`, without locking out individual toggles in between.
  const [fixedExpandAll, setFixedExpandAll] = useState({ open: false, version: 0 })
  const [variableExpandAll, setVariableExpandAll] = useState({ open: false, version: 0 })
  const [supplierExpandAll, setSupplierExpandAll] = useState({ open: false, version: 0 })
  const [supplierFilters, setSupplierFilters] = useState({ query: '', categoryId: '' })
  const [selectedDate, setSelectedDate] = useState(new Date())

  // Modals
  const [supplierModal, setSupplierModal] = useState({ open: false, supplier: null })
  const [deleteModal, setDeleteModal] = useState({ open: false, type: null, item: null })
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [fixedModal, setFixedModal] = useState({ open: false, item: null })
  const [variableModal, setVariableModal] = useState({ open: false, item: null })
  const [copyModalOpen, setCopyModalOpen] = useState(false)
  const [extraordinaryModal, setExtraordinaryModal] = useState({ open: false, item: null })
  const [employeeModal, setEmployeeModal] = useState({ open: false, employee: null })
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false)
  const [standaloneModalOpen, setStandaloneModalOpen] = useState(false)

  const year = selectedDate.getFullYear()
  const month = selectedDate.getMonth()

  // Collapse the header title when the sticky bar pins. A 1px sentinel above the
  // header: once it scrolls out of the viewport, the header is stuck.
  const [stuck, setStuck] = useState(false)
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  const loadData = async () => {
    setLoading(true)
    try {
      const [suppliersData, expensesData, fixedData, categoriesData, extraordinaryData, pctSetting] = await Promise.all([
        getSuppliers(),
        getExpensesByMonth(year, month),
        getFixedExpenses(),
        getCategories(),
        getExtraordinaryByMonth(year, month),
        getSetting('contingency_fund_pct')
      ])
      setSuppliers(suppliersData)
      setExpenses(expensesData)
      setFixedExpenses(fixedData)
      setCategories(categoriesData)
      setExtraordinaryExpenses(extraordinaryData)
      setContingencyPct(pctSetting != null ? Number(pctSetting) : 10)
      if (hasAccess('salaries')) {
        const [employeesData, standaloneData, providersData] = await Promise.all([
          getEmployees(),
          getStandaloneExtraCosts(),
          getServiceProviders()
        ])
        setEmployees(employeesData)
        setStandaloneCosts(standaloneData)
        setServiceProviders(providersData)
      }
    } catch (error) {
      console.error('Error cargando datos:', error)
    } finally {
      setLoading(false)
    }
  }

  const providersMonthlyTotal = providerCostForMonth(serviceProviders)

  const handleSaveProvider = async ({ id, ...input }) => {
    if (id) await updateServiceProvider(id, input)
    else await createServiceProvider(input)
    setServiceProviders(await getServiceProviders())
  }

  const handleToggleProviderActive = async (provider) => {
    await updateServiceProvider(provider.id, { active: !provider.active })
    setServiceProviders(await getServiceProviders())
  }

  const handleDeleteProvider = async (id) => {
    if (!window.confirm('¿Eliminar este prestador? Se borra del historial y deja de sumar en todos los meses.')) return
    await deleteServiceProvider(id)
    setServiceProviders(await getServiceProviders())
  }

  // Month totals for summary cards.
  const variableTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const fixedCashThisMonth = fixedCashForMonth(fixedExpenses, year, month)
  const fixedMonthlyThisMonth = fixedMonthlyForMonth(fixedExpenses, year, month)
  const extraordinaryTotal = extraordinaryExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const contingencyLimitAmount = contingencyLimit(fixedMonthlyThisMonth, contingencyPct)
  const totalCashMonth = variableTotal + fixedCashThisMonth + extraordinaryTotal

  // Standalone extra costs (no employee) belong to a month via their date.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const standaloneThisMonth = standaloneCosts.filter(c => String(c.date || '').slice(0, 7) === monthPrefix)

  // Filter option lists derived from loaded data.
  const categoryOptions = categories.map(c => ({ value: c.id, label: c.name }))
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }))

  const getSupplierName = (supplierId) => suppliers.find(s => s.id === supplierId)?.name

  // Accessors shared by fixed & variable expenses.
  const expenseAccessors = {
    getText: (e) => [e.description, e.notes, getSupplierName(e.supplierId)].filter(Boolean).join(' '),
    getCategoryId: (e) => e.categoryId,
    getSupplierId: (e) => e.supplierId,
    getAmount: (e) => Number(e.amount)
  }
  const expenseGroupOpts = {
    getKey: (e) => e.categoryId,
    getLabel: (e) => e.categoryName,
    getAmount: (e) => Number(e.amount)
  }

  const variableGroups = groupByCategory(
    filterItems(expenses, variableFilters, expenseAccessors),
    expenseGroupOpts
  )

  const extraordinaryGroups = groupByCategory(
    filterItems(extraordinaryExpenses, emptyFilters, expenseAccessors),
    expenseGroupOpts
  )

  // Hide finalized templates (no upcoming payment for the viewed month).
  const activeFixedExpenses = fixedExpenses.filter(f => nextPayment(f, year, month) != null)

  const fixedGroups = groupByCategory(
    filterItems(activeFixedExpenses, fixedFilters, expenseAccessors),
    expenseGroupOpts
  )

  // Suppliers reference an expense category; reuse the shared category options.
  const supplierCategoryOptions = categoryOptions

  const supplierGroups = groupByCategory(
    filterItems(suppliers, supplierFilters, {
      getText: (s) => [s.name, s.contact, s.notes].filter(Boolean).join(' '),
      getCategoryId: (s) => s.categoryId
    }),
    { getKey: (s) => s.categoryId, getLabel: (s) => s.categoryName }
  )

  // Handlers
  const handleDeleteExpense = async () => {
    if (!deleteModal.item) return
    try {
      await deleteExpense(deleteModal.item.id)
      setDeleteModal({ open: false, type: null, item: null })
      loadData()
    } catch (error) {
      console.error('Error eliminando gasto:', error)
    }
  }

  const handleDeleteExtraordinary = async (id) => {
    if (!window.confirm('¿Eliminar este gasto extraordinario del fondo de contingencia?')) return
    try {
      await deleteExtraordinary(id)
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }

  const handleSaveContingencyPct = async (newPct) => {
    try {
      await setSetting('contingency_fund_pct', newPct)
      setContingencyPct(newPct)
    } catch (e) {
      alert('Error al guardar el porcentaje: ' + e.message)
    }
  }

  const handleDeleteSupplier = async () => {
    if (!deleteModal.item) return
    try {
      await deleteSupplier(deleteModal.item.id)
      setDeleteModal({ open: false, type: null, item: null })
      loadData()
    } catch (error) {
      console.error('Error eliminando proveedor:', error)
    }
  }

  const handleDeleteFixed = async (id) => {
    if (!window.confirm('¿Eliminar este gasto fijo? Dejará de impactar en el dashboard.')) return
    try {
      await deleteFixedExpense(id)
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }

  const handleDeleteEmployee = async (id) => {
    if (!window.confirm('¿Eliminar empleado y toda su historia de sueldos? Esta acción no se puede deshacer.')) return
    try {
      await deleteEmployee(id)
      setEmployeeModal({ open: false, employee: null })
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }

  const handleDeleteStandalone = async (id) => {
    if (!window.confirm('¿Eliminar este gasto extraordinario?')) return
    try {
      await deleteExtraCost(id)
      await loadData()
    } catch (e) {
      alert('Error al eliminar: ' + e.message)
    }
  }

  const selectedEmployee = employeeModal.employee
    ? employees.find(e => e.id === employeeModal.employee.id) || null
    : null

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8">
      {/* Sentinel: cuando sale del viewport, el header queda pegado */}
      <div ref={sentinelRef} className="h-px" />
      {/* Sticky header: título + navegación de mes + acciones */}
      <div className={`sticky top-0 z-20 bg-gray-50/90 backdrop-blur-sm border-b border-gray-200 px-4 sm:px-6 lg:px-8 transition-all duration-300 ${stuck ? 'py-2.5' : 'py-4'}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className={`flex items-center min-w-0 transition-all duration-300 ${stuck ? 'gap-0' : 'gap-4'}`}>
            <div className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${stuck ? 'max-w-0 opacity-0 -translate-x-2' : 'max-w-[360px] opacity-100 translate-x-0'}`}>
              <h1 className="text-2xl font-semibold text-gray-900">Costos</h1>
              <p className="text-gray-500 text-sm mt-0.5">Gestión de costos operativos</p>
            </div>
            <MonthNavigator
              selected={{ year, month }}
              onChange={({ year: y, month: m }) => setSelectedDate(new Date(y, m, 1))}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => setCategoryModalOpen(true)}>
              Categorías
            </Button>
            <Button variant="secondary" onClick={() => setFixedModal({ open: true, item: null })}>
              <Plus className="w-4 h-4" />
              Gasto fijo
            </Button>
            <Button onClick={() => setVariableModal({ open: true, item: null })} className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4" />
              Gasto variable
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 sm:px-6 lg:px-8 py-8">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Total del mes (caja)</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalCashMonth)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos fijos (impacto este mes)</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(fixedCashThisMonth)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos variables</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(variableTotal)}</p>
          <p className="text-xs text-gray-400">{expenses.length} gastos</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Fijos mensualizado (ref.)</p>
          <p className="text-2xl font-bold text-gray-700">{formatCurrency(fixedMonthlyThisMonth)}</p>
        </Card>
      </div>

      {/* Contingency fund */}
      <ContingencyFundBar
        limitAmount={contingencyLimitAmount}
        consumed={extraordinaryTotal}
        pct={contingencyPct}
        canEdit={hasAccess('expense_settings')}
        onSavePct={handleSaveContingencyPct}
        count={extraordinaryExpenses.length}
      >
        <div className="flex justify-end mb-3">
          <Button variant="secondary" onClick={() => setExtraordinaryModal({ open: true, item: null })}>
            <Plus className="w-4 h-4" />
            Gasto extraordinario
          </Button>
        </div>
        {extraordinaryGroups.length === 0 ? (
          <Card className="p-6 text-center"><p className="text-gray-500">No hay gastos extraordinarios este mes</p></Card>
        ) : (
          extraordinaryGroups.map(group => (
            <CategoryGroup key={group.key} storageKey={`extraordinary.${group.key}`} label={group.label} count={group.items.length} subtotal={group.subtotal}>
              {group.items.map(expense => (
                <VariableExpenseCard
                  key={expense.id}
                  expense={expense}
                  supplierName={getSupplierName(expense.supplierId)}
                  onEdit={() => setExtraordinaryModal({ open: true, item: expense })}
                  onDelete={() => handleDeleteExtraordinary(expense.id)}
                />
              ))}
            </CategoryGroup>
          ))
        )}
      </ContingencyFundBar>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gastos fijos (plantillas) */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              Gastos fijos
            </h3>
            <CostsFilterBar
              filters={fixedFilters}
              onChange={setFixedFilters}
              categoryOptions={categoryOptions}
              supplierOptions={supplierOptions}
              showAmountRange
              searchPlaceholder="Buscar gasto fijo…"
              trailing={
                <ExpandCollapseAllButton
                  expanded={fixedExpandAll.open}
                  onClick={() => setFixedExpandAll(s => ({ open: !s.open, version: s.version + 1 }))}
                />
              }
            />
            {fixedGroups.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-500">Sin gastos fijos</p></Card>
            ) : (
              fixedGroups.map(group => (
                <CategoryGroup key={group.key} storageKey={`fixed.${group.key}`} label={group.label} count={group.items.length} subtotal={group.subtotal} forceOpen={fixedExpandAll}>
                  {group.items.map(f => (
                    <FixedExpenseCard
                      key={f.id}
                      fixed={f}
                      year={year}
                      month={month}
                      onEdit={() => setFixedModal({ open: true, item: f })}
                      onDelete={() => handleDeleteFixed(f.id)}
                    />
                  ))}
                </CategoryGroup>
              ))
            )}
          </div>

          {/* Gastos variables (mes) */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                Gastos variables
              </h3>
              <Button variant="secondary" onClick={() => setCopyModalOpen(true)}>
                Copiar del mes pasado
              </Button>
            </div>
            <CostsFilterBar
              filters={variableFilters}
              onChange={setVariableFilters}
              categoryOptions={categoryOptions}
              supplierOptions={supplierOptions}
              showAmountRange
              searchPlaceholder="Buscar gasto…"
              trailing={
                <ExpandCollapseAllButton
                  expanded={variableExpandAll.open}
                  onClick={() => setVariableExpandAll(s => ({ open: !s.open, version: s.version + 1 }))}
                />
              }
            />
            {variableGroups.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-500">No hay gastos variables este mes</p></Card>
            ) : (
              variableGroups.map(group => (
                <CategoryGroup key={group.key} storageKey={`variable.${group.key}`} label={group.label} count={group.items.length} subtotal={group.subtotal} forceOpen={variableExpandAll}>
                  {group.items.map(expense => (
                    <VariableExpenseCard
                      key={expense.id}
                      expense={expense}
                      supplierName={getSupplierName(expense.supplierId)}
                      onEdit={() => setVariableModal({ open: true, item: expense })}
                      onDelete={() => setDeleteModal({ open: true, type: 'expense', item: expense })}
                    />
                  ))}
                </CategoryGroup>
              ))
            )}
          </div>
        </div>
      )}

      {/* Suppliers directory */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Proveedores (directorio) ({suppliers.length})
          </h3>
          <Button variant="secondary" onClick={() => setSupplierModal({ open: true, supplier: null })}>
            <Plus className="w-4 h-4" />
            Nuevo proveedor
          </Button>
        </div>

        <CostsFilterBar
          filters={supplierFilters}
          onChange={setSupplierFilters}
          categoryOptions={supplierCategoryOptions}
          searchPlaceholder="Buscar proveedor…"
          trailing={
            <ExpandCollapseAllButton
              expanded={supplierExpandAll.open}
              onClick={() => setSupplierExpandAll(s => ({ open: !s.open, version: s.version + 1 }))}
            />
          }
        />

        {supplierGroups.length === 0 ? (
          <Card className="p-6 text-center"><p className="text-gray-500">No hay proveedores</p></Card>
        ) : (
          supplierGroups.map(group => (
            <CategoryGroup key={group.key} storageKey={`suppliers.${group.key}`} label={group.label} count={group.items.length} forceOpen={supplierExpandAll}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map(supplier => (
                  <Card key={supplier.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">{supplier.name}</h4>
                        {supplier.categoryName && (
                          <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                            {supplier.categoryName}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setSupplierModal({ open: true, supplier })}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteModal({ open: true, type: 'supplier', item: supplier })}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {supplier.contact && (
                      <p className="text-sm text-gray-500 mt-2">{supplier.contact}</p>
                    )}
                    {supplier.phone && (
                      <p className="text-sm text-gray-500">{supplier.phone}</p>
                    )}
                  </Card>
                ))}
              </div>
            </CategoryGroup>
          ))
        )}
      </div>

      {/* Sueldos / Empleados (solo superadmin) */}
      {hasAccess('salaries') && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Sueldos</h3>
            <Button onClick={() => setAddEmployeeOpen(true)}>
              <Plus className="w-4 h-4" />
              Empleado
            </Button>
          </div>

          {employees.length === 0 ? (
            <Card className="p-6 text-center"><p className="text-gray-500">Sin empleados</p></Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.map(emp => {
                const cur = currentSalary(emp.adjustments)
                const costo = cur ? monthlyCostBreakdown(cur.liquido, emp.hasIrpf) : null
                return (
                  <Card
                    key={emp.id}
                    className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${!emp.active ? 'opacity-60' : ''}`}
                    onClick={() => setEmployeeModal({ open: true, employee: emp })}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h5 className="font-medium text-gray-900">{emp.name}</h5>
                        {emp.role && <p className="text-xs text-gray-500">{emp.role}</p>}
                      </div>
                      {!emp.active && <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Baja</span>}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-500">Costo mensual a la compañía</p>
                      <p className="text-lg font-semibold text-gray-900">{formatCurrency(costo?.total || 0)}</p>
                      {cur && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Líquido: {formatCurrency(cur.liquido)} · Nominal: {formatCurrency(costo.nominal)}
                          {emp.hasIrpf && ' · IRPF'}
                        </p>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Prestadores de servicios (no empleados): monto fijo mensual, sin
              aguinaldo ni vacacional. Cuentan como sueldo en el dashboard. */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-2">
                <h4 className="text-sm font-semibold text-gray-700">Prestadores de servicios</h4>
                {providersMonthlyTotal > 0 && (
                  <span className="text-xs text-gray-500">{formatCurrency(providersMonthlyTotal)}/mes</span>
                )}
              </div>
              <Button variant="secondary" onClick={() => setProviderModal({ open: true, provider: null })}>
                <Plus className="w-4 h-4" />
                Prestador
              </Button>
            </div>
            {serviceProviders.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-gray-500">Sin prestadores de servicios</p>
                <p className="text-xs text-gray-400 mt-1">
                  Gastos fijos mensuales de quienes no son empleados: choferes contratados, contador, autos de terceros
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {serviceProviders.map(pv => (
                  <Card key={pv.id} className={`p-4 ${!pv.active ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h5 className="font-medium text-gray-900 truncate">{pv.name}</h5>
                          {!pv.active && (
                            <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded shrink-0">Baja</span>
                          )}
                        </div>
                        {pv.role && <p className="text-xs text-gray-500 mt-0.5">{pv.role}</p>}
                        {pv.notes && <p className="text-xs text-gray-400 mt-1">{pv.notes}</p>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">{formatCurrency(pv.monthlyAmount)}</p>
                          <p className="text-xs text-gray-400">por mes</p>
                        </div>
                        <button
                          onClick={() => setProviderModal({ open: true, provider: pv })}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleProviderActive(pv)}
                          className="text-xs px-2 py-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          {pv.active ? 'Dar de baja' : 'Reactivar'}
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(pv.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Extraordinarios sin empleado */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700">Extraordinarios sin empleado</h4>
              <Button variant="secondary" onClick={() => setStandaloneModalOpen(true)}>
                <Plus className="w-4 h-4" />
                Agregar
              </Button>
            </div>
            {standaloneThisMonth.length === 0 ? (
              <Card className="p-6 text-center"><p className="text-gray-500">Sin gastos extraordinarios este mes</p></Card>
            ) : (
              <div className="space-y-3">
                {standaloneThisMonth.map(c => (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h5 className="font-medium text-gray-900">{c.concept || 'Sin concepto'}</h5>
                        <p className="text-xs text-gray-400 mt-1">{format(parseDateOnly(c.date), 'd MMM yyyy', { locale: es })}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-semibold text-gray-900">{formatCurrency(c.amount)}</p>
                        <button
                          onClick={() => handleDeleteStandalone(c.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Category manager */}
      <CategoryManagerModal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        categories={categories}
        onChanged={loadData}
      />

      {/* Fixed expense modal */}
      <FixedExpenseModal
        isOpen={fixedModal.open}
        onClose={() => setFixedModal({ open: false, item: null })}
        fixed={fixedModal.item}
        categories={categories}
        suppliers={suppliers}
        onSave={loadData}
      />

      {/* Variable expense modal */}
      <VariableExpenseModal
        isOpen={variableModal.open}
        onClose={() => setVariableModal({ open: false, item: null })}
        expense={variableModal.item}
        categories={categories}
        suppliers={suppliers}
        selectedYear={year}
        selectedMonth={month}
        onSave={loadData}
      />

      {/* Copy last month's variable expenses */}
      <CopyLastMonthVariablesModal
        isOpen={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        year={year}
        month={month}
        onSaved={loadData}
      />

      {/* Extraordinary expense modal */}
      <ExtraordinaryExpenseModal
        isOpen={extraordinaryModal.open}
        onClose={() => setExtraordinaryModal({ open: false, item: null })}
        expense={extraordinaryModal.item}
        categories={categories}
        suppliers={suppliers}
        selectedYear={year}
        selectedMonth={month}
        onSave={loadData}
      />

      {/* Supplier Modal */}
      <SupplierModal
        isOpen={supplierModal.open}
        onClose={() => setSupplierModal({ open: false, supplier: null })}
        supplier={supplierModal.supplier}
        categories={categories}
        onSave={loadData}
      />

      {/* Employee ficha modal */}
      <EmployeeFichaModal
        isOpen={employeeModal.open}
        employee={selectedEmployee}
        onClose={() => setEmployeeModal({ open: false, employee: null })}
        onChanged={loadData}
        onDelete={handleDeleteEmployee}
      />

      {/* Add employee modal */}
      <AddEmployeeModal
        isOpen={addEmployeeOpen}
        onClose={() => setAddEmployeeOpen(false)}
        onSave={loadData}
      />

      {/* Service provider modal */}
      <ServiceProviderModal
        isOpen={providerModal.open}
        provider={providerModal.provider}
        onClose={() => setProviderModal({ open: false, provider: null })}
        onSave={handleSaveProvider}
      />

      {/* Standalone extra cost modal */}
      <StandaloneCostModal
        isOpen={standaloneModalOpen}
        onClose={() => setStandaloneModalOpen(false)}
        onSave={loadData}
      />

      {/* Delete Modal */}
      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, type: null, item: null })}
        title={deleteModal.type === 'supplier' ? 'Eliminar proveedor' : 'Eliminar gasto'}
      >
        <p className="text-gray-600 mb-6">
          ¿Estás seguro de que deseas eliminar {deleteModal.type === 'supplier' ? 'este proveedor' : 'este gasto'}?
          Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3 justify-end">
          <Button
            variant="secondary"
            onClick={() => setDeleteModal({ open: false, type: null, item: null })}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={deleteModal.type === 'supplier' ? handleDeleteSupplier : handleDeleteExpense}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
      </div>
    </div>
  )
}

// Category CRUD manager
function CategoryManagerModal({ isOpen, onClose, categories, onChanged }) {
  const [form, setForm] = useState({ id: null, name: '', description: '' })
  const [busy, setBusy] = useState(false)

  const reset = () => setForm({ id: null, name: '', description: '' })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (form.id) {
        await updateCategory(form.id, { name: form.name, description: form.description })
      } else {
        await createCategory({ name: form.name, description: form.description })
      }
      reset()
      onChanged()
    } catch (err) {
      alert('Error al guardar categoría: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar esta categoría? Los gastos asociados quedarán sin categoría.')) return
    setBusy(true)
    try {
      await deleteCategory(id)
      if (form.id === id) reset()
      onChanged()
    } catch (err) {
      alert('Error al eliminar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Categorías de gasto">
      <form onSubmit={submit} className="bg-gray-50 rounded-lg p-3 space-y-3 mb-4">
        <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qué incluye" />
        <div className="flex justify-end gap-2">
          {form.id && <Button type="button" variant="secondary" onClick={reset}>Cancelar edición</Button>}
          <Button type="submit" disabled={busy}>{form.id ? 'Guardar' : 'Agregar'}</Button>
        </div>
      </form>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {categories.map(c => (
          <div key={c.id} className="flex items-start justify-between border border-gray-100 rounded-lg px-3 py-2">
            <div className="flex-1 pr-2">
              <p className="font-medium text-gray-900">{c.name}</p>
              {c.description && <p className="text-xs text-gray-400">{c.description}</p>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setForm({ id: c.id, name: c.name, description: c.description || '' })} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => remove(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                <Trash className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// Fixed expense card (template)
function FixedExpenseCard({ fixed, year, month, onEdit, onDelete }) {
  const hitsThis = hitsMonth(fixed, year, month)
  const next = nextPayment(fixed, year, month)
  const monthly = monthlyAmount(fixed)
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900">{fixed.description}</h4>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">{periodicityLabel(fixed.periodMonths)}</span>
            {fixed.categoryName && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{fixed.categoryName}</span>}
            {hitsThis && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Impacta este mes</span>}
          </div>
          {fixed.supplierName && <p className="text-sm text-gray-500 mt-1">{fixed.supplierName}</p>}
          {fixed.notes && <p className="text-xs text-gray-400 mt-1">{fixed.notes}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(Number(fixed.amount))}</p>
          <p className="text-xs text-gray-400">{formatCurrency(monthly)}/mes</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          {next ? `Próximo pago: ${format(new Date(next.year, next.month, 1), 'MMM yyyy', { locale: es })}` : 'Finalizado'}
        </p>
        <div className="flex gap-2">
          <button onClick={onEdit} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
          <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash className="w-4 h-4" /></button>
        </div>
      </div>
    </Card>
  )
}

// Variable expense card (one-off)
function VariableExpenseCard({ expense, supplierName, onEdit, onDelete }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900">{expense.description}</h4>
            {expense.categoryName && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{expense.categoryName}</span>}
          </div>
          {supplierName && <p className="text-sm text-gray-500 mt-1">{supplierName}</p>}
          {expense.notes && <p className="text-xs text-gray-400 mt-1">{expense.notes}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(Number(expense.amount))}</p>
          <p className="text-xs text-gray-400">{format(parseDateOnly(expense.date), 'd MMM', { locale: es })}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
        <button onClick={onEdit} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Edit className="w-4 h-4" /></button>
        <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash className="w-4 h-4" /></button>
      </div>
    </Card>
  )
}

// Bulk-toggles every CategoryGroup in a section between fully expanded/collapsed.
function ExpandCollapseAllButton({ expanded, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? 'Contraer todos' : 'Expandir todos'}
      className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
    >
      {expanded ? <CompressLines className="w-4 h-4" /> : <ExpandLines className="w-4 h-4" />}
      <span>{expanded ? 'Contraer todos' : 'Expandir todos'}</span>
    </button>
  )
}

function CategorySelect({ value, onChange, categories }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
      <select
        value={value}
        onChange={onChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      >
        <option value="">Sin categoría</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )
}

// Picking a supplier on an expense form auto-fills the description with the
// supplier's name and the category with the supplier's own category. Clearing
// the supplier leaves the fields untouched. Everything stays overwritable.
function applySupplierAutofill(setForm, suppliers, supplierId) {
  const supplier = suppliers.find(s => s.id === supplierId)
  setForm(f => ({
    ...f,
    supplierId,
    description: supplier ? supplier.name : f.description,
    categoryId: supplier && supplier.categoryId ? supplier.categoryId : f.categoryId
  }))
}

function SupplierSelect({ value, onChange, suppliers }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor (opcional)</label>
      <select
        value={value}
        onChange={onChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      >
        <option value="">Sin proveedor</option>
        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  )
}

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// Fixed expense modal (template)
function FixedExpenseModal({ isOpen, onClose, fixed, categories, suppliers, onSave }) {
  const now = new Date()
  const empty = {
    description: '', categoryId: '', supplierId: '', amount: '',
    periodMonths: 1, startYear: now.getFullYear(), startMonth: now.getMonth(),
    hasEnd: false, endYear: now.getFullYear(), endMonth: now.getMonth(), notes: ''
  }
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (fixed) {
      setForm({
        description: fixed.description || '',
        categoryId: fixed.categoryId || '',
        supplierId: fixed.supplierId || '',
        amount: String(fixed.amount ?? ''),
        periodMonths: fixed.periodMonths || 1,
        startYear: fixed.startYear,
        startMonth: fixed.startMonth,
        hasEnd: fixed.endYear != null && fixed.endMonth != null,
        endYear: fixed.endYear ?? now.getFullYear(),
        endMonth: fixed.endMonth ?? now.getMonth(),
        notes: fixed.notes || ''
      })
    } else {
      setForm(empty)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed, isOpen])

  const onSupplierChange = (supplierId) => applySupplierAutofill(setForm, suppliers, supplierId)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const payload = {
      description: form.description,
      categoryId: form.categoryId || null,
      supplierId: form.supplierId || null,
      amount: parseFloat(form.amount),
      periodMonths: Number(form.periodMonths),
      startYear: Number(form.startYear),
      startMonth: Number(form.startMonth),
      endYear: form.hasEnd ? Number(form.endYear) : null,
      endMonth: form.hasEnd ? Number(form.endMonth) : null,
      notes: form.notes
    }
    try {
      if (fixed) await updateFixedExpense(fixed.id, payload)
      else await createFixedExpense(payload)
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar gasto fijo: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={fixed ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}>
      <form onSubmit={submit} className="space-y-4">
        <SupplierSelect value={form.supplierId} onChange={(e) => onSupplierChange(e.target.value)} suppliers={suppliers} />
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Alquiler del local" required />
        <CategorySelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} categories={categories} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto por pago" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Periodicidad</label>
            <select value={form.periodMonths} onChange={(e) => setForm({ ...form, periodMonths: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
              {PERIODICITY_OPTIONS.map(o => <option key={o.months} value={o.months}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primer pago (mes)</label>
            <select value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <Input label="Primer pago (año)" type="number" value={form.startYear} onChange={(e) => setForm({ ...form, startYear: e.target.value })} required />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.hasEnd} onChange={(e) => setForm({ ...form, hasEnd: e.target.checked })} />
          Tiene fecha de fin
        </label>
        {form.hasEnd && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fin (mes)</label>
              <select value={form.endMonth} onChange={(e) => setForm({ ...form, endMonth: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
            </div>
            <Input label="Fin (año)" type="number" value={form.endYear} onChange={(e) => setForm({ ...form, endYear: e.target.value })} />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>{fixed ? 'Guardar cambios' : 'Crear gasto fijo'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Variable expense modal (one-off)
function VariableExpenseModal({ isOpen, onClose, expense, categories, suppliers, selectedYear, selectedMonth, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ supplierId: '', categoryId: '', description: '', amount: '', date: '', notes: '', isOneOff: false })

  useEffect(() => {
    if (expense) {
      setForm({
        supplierId: expense.supplierId || '',
        categoryId: expense.categoryId || '',
        description: expense.description || '',
        amount: expense.amount?.toString() || '',
        date: expense.date || '',
        notes: expense.notes || '',
        isOneOff: expense.isOneOff || false
      })
    } else {
      const defaultDate = new Date(selectedYear, selectedMonth, 1)
      setForm({ supplierId: '', categoryId: '', description: '', amount: '', date: format(defaultDate, 'yyyy-MM-dd'), notes: '', isOneOff: false })
    }
  }, [expense, isOpen, selectedYear, selectedMonth])

  // Picking a supplier auto-fills description (its name) and category (its own),
  // both still overwritable afterwards.
  const onSupplierChange = (supplierId) => applySupplierAutofill(setForm, suppliers, supplierId)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const expenseDate = parseDateOnly(form.date)
    const payload = {
      supplierId: form.supplierId || null,
      categoryId: form.categoryId || null,
      description: form.description,
      amount: parseFloat(form.amount),
      date: form.date,
      notes: form.notes,
      isOneOff: form.isOneOff,
      year: expenseDate.getFullYear(),
      month: expenseDate.getMonth()
    }
    try {
      if (expense) await updateExpense(expense.id, payload)
      else await createExpense(payload)
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar gasto: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={expense ? 'Editar gasto variable' : 'Registrar gasto variable'}>
      <form onSubmit={submit} className="space-y-4">
        <SupplierSelect value={form.supplierId} onChange={(e) => onSupplierChange(e.target.value)} suppliers={suppliers} />
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Reparación de heladera" required />
        <CategorySelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} categories={categories} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.isOneOff} onChange={(e) => setForm({ ...form, isOneOff: e.target.checked })} className="rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
          <span className="text-sm text-gray-700">Gasto único</span>
          <span className="group relative inline-flex">
            <InfoCircle className="w-4 h-4 text-gray-400" />
            <span className="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 w-56 rounded-lg bg-gray-900 text-white text-xs px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              Un gasto único no aparecerá en "Copiar del mes pasado" de gastos variables.
            </span>
          </span>
        </label>
        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>{expense ? 'Guardar cambios' : 'Registrar gasto'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Copy last month's variable expenses into the current month. Preview list with
// inline-editable amounts + per-row include toggle; confirm creates them.
function CopyLastMonthVariablesModal({ isOpen, onClose, year, month, onSaved }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const prev = new Date(year, month - 1, 1)
  const prevYear = prev.getFullYear()
  const prevMonth = prev.getMonth()

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    getExpensesByMonth(prevYear, prevMonth)
      .then(data => setRows(data.filter(e => !e.isOneOff).map(e => ({
        include: true,
        description: e.description,
        categoryId: e.categoryId,
        categoryName: e.categoryName,
        supplierId: e.supplierId,
        amount: String(e.amount ?? '')
      }))))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prevYear, prevMonth])

  const setRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const selected = rows.filter(r => r.include && parseFloat(r.amount) > 0)

  const confirm = async () => {
    setSaving(true)
    const date = format(new Date(year, month, 1), 'yyyy-MM-dd')
    try {
      for (const r of selected) {
        await createExpense({
          supplierId: r.supplierId || null,
          categoryId: r.categoryId || null,
          description: r.description,
          amount: parseFloat(r.amount),
          date,
          notes: '',
          year,
          month
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      alert('Error al copiar gastos: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const prevLabel = format(prev, 'MMMM yyyy', { locale: es })

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Copiar gastos variables del mes pasado">
      <p className="text-sm text-gray-500 mb-3 capitalize">Desde {prevLabel}</p>
      {loading ? (
        <p className="text-gray-500 py-6 text-center">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 py-6 text-center">No hubo gastos variables el mes pasado.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className={`flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2 ${r.include ? '' : 'opacity-50'}`}>
              <input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{r.description}</p>
                {r.categoryName && <p className="text-xs text-gray-400">{r.categoryName}</p>}
              </div>
              <input
                type="number"
                value={r.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                className="w-28 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right"
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="button" onClick={confirm} loading={saving} disabled={selected.length === 0}>
          Agregar {selected.length > 0 ? `(${selected.length})` : ''}
        </Button>
      </div>
    </Modal>
  )
}

// Extraordinary expense modal (contingency fund)
function ExtraordinaryExpenseModal({ isOpen, onClose, expense, categories, suppliers, selectedYear, selectedMonth, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ supplierId: '', categoryId: '', description: '', amount: '', date: '', notes: '' })

  useEffect(() => {
    if (expense) {
      setForm({
        supplierId: expense.supplierId || '',
        categoryId: expense.categoryId || '',
        description: expense.description || '',
        amount: expense.amount?.toString() || '',
        date: expense.date || '',
        notes: expense.notes || ''
      })
    } else {
      const defaultDate = new Date(selectedYear, selectedMonth, 1)
      setForm({ supplierId: '', categoryId: '', description: '', amount: '', date: format(defaultDate, 'yyyy-MM-dd'), notes: '' })
    }
  }, [expense, isOpen, selectedYear, selectedMonth])

  const onSupplierChange = (supplierId) => applySupplierAutofill(setForm, suppliers, supplierId)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const expenseDate = parseDateOnly(form.date)
    const payload = {
      supplierId: form.supplierId || null,
      categoryId: form.categoryId || null,
      description: form.description,
      amount: parseFloat(form.amount),
      date: form.date,
      notes: form.notes,
      year: expenseDate.getFullYear(),
      month: expenseDate.getMonth()
    }
    try {
      if (expense) await updateExtraordinary(expense.id, payload)
      else await createExtraordinary(payload)
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar gasto extraordinario: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={expense ? 'Editar gasto extraordinario' : 'Registrar gasto extraordinario'}>
      <form onSubmit={submit} className="space-y-4">
        <SupplierSelect value={form.supplierId} onChange={(e) => onSupplierChange(e.target.value)} suppliers={suppliers} />
        <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Reparación imprevista" required />
        <CategorySelect value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} categories={categories} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>{expense ? 'Guardar cambios' : 'Registrar gasto'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Supplier modal (directory)
function SupplierModal({ isOpen, onClose, supplier, categories, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    contact: '',
    phone: '',
    email: '',
    notes: ''
  })

  useEffect(() => {
    if (supplier) {
      setForm({
        name: supplier.name || '',
        categoryId: supplier.categoryId || '',
        contact: supplier.contact || '',
        phone: supplier.phone || '',
        email: supplier.email || '',
        notes: supplier.notes || ''
      })
    } else {
      setForm({
        name: '',
        categoryId: '',
        contact: '',
        phone: '',
        email: '',
        notes: ''
      })
    }
  }, [supplier, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (supplier) {
        await updateSupplier(supplier.id, form)
      } else {
        await createSupplier(form)
      }
      onSave()
      onClose()
    } catch (error) {
      console.error('Error guardando proveedor:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nombre"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />

        <CategorySelect
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          categories={categories}
        />

        <Input
          label="Contacto"
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Teléfono"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notas
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {supplier ? 'Guardar cambios' : 'Crear proveedor'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// El nominal y el costo a la compañía se derivan del líquido: se muestran en
// vivo para que quien carga vea qué está generando.
function DerivedSalaryPreview({ liquido, hasIrpf }) {
  const n = Number(liquido)
  if (!n) return null
  const b = monthlyCostBreakdown(n, hasIrpf)
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
      <div className="flex justify-between">
        <span>Nominal (líquido / {hasIrpf ? '0,781' : '0,804'})</span>
        <span className="font-medium text-gray-900">{formatCurrency(b.nominal)}</span>
      </div>
      <div className="flex justify-between"><span>+ Aportes patronales (12,6%)</span><span>{formatCurrency(b.aportes)}</span></div>
      <div className="flex justify-between"><span>+ Aguinaldo mensualizado</span><span>{formatCurrency(b.aguinaldo)}</span></div>
      <div className="flex justify-between"><span>+ Salario vacacional</span><span>{formatCurrency(b.vacacional)}</span></div>
      <div className="flex justify-between pt-1 border-t border-gray-200 font-semibold text-gray-900">
        <span>Costo mensual a la compañía</span><span>{formatCurrency(b.total)}</span>
      </div>
    </div>
  )
}

function AddEmployeeModal({ isOpen, onClose, onSave }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [form, setForm] = useState({ name: '', role: '', liquido: '', hasIrpf: false, semesterAdjustmentPct: '3.5', effectiveDate: today })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setForm({ name: '', role: '', liquido: '', hasIrpf: false, semesterAdjustmentPct: '3.5', effectiveDate: today })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createEmployee({
        name: form.name,
        role: form.role,
        semesterAdjustmentPct: Number(form.semesterAdjustmentPct) || 3.5,
        liquido: Number(form.liquido),
        hasIrpf: form.hasIrpf,
        effectiveDate: form.effectiveDate
      })
      onSave()
      onClose()
    } catch (err) {
      alert('Error al crear empleado: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo empleado">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ej: Coordinadora" />
        <Input label="Sueldo líquido mensual" type="number" min="0" step="0.01" value={form.liquido} onChange={(e) => setForm({ ...form, liquido: e.target.value })} required />
        <Checkbox
          label="Aporta IRPF"
          checked={form.hasIrpf}
          onChange={(e) => setForm({ ...form, hasIrpf: e.target.checked })}
        />
        <DerivedSalaryPreview liquido={form.liquido} hasIrpf={form.hasIrpf} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Ajuste semestral (%)" type="number" step="0.1" value={form.semesterAdjustmentPct} onChange={(e) => setForm({ ...form, semesterAdjustmentPct: e.target.value })} />
          <Input label="Vigente desde" type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Crear'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Prestador de servicios: nombre, rol y monto mensual. El monto mensual es el
// monto mensual — no hay historial de tarifa ni nada que mensualizar.
function ServiceProviderModal({ isOpen, onClose, provider, onSave }) {
  const [form, setForm] = useState({ name: '', role: '', monthlyAmount: '', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setForm({
      name: provider?.name || '',
      role: provider?.role || '',
      monthlyAmount: provider?.monthlyAmount != null ? String(provider.monthlyAmount) : '',
      notes: provider?.notes || ''
    })
  }, [isOpen, provider])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        id: provider?.id,
        name: form.name,
        role: form.role,
        monthlyAmount: Number(form.monthlyAmount),
        notes: form.notes
      })
      onClose()
    } catch (err) {
      alert('Error al guardar el prestador: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={provider ? 'Editar prestador' : 'Nuevo prestador de servicios'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ej: Chofer, Contador" />
        <Input
          label="Monto mensual"
          type="number"
          min="0"
          step="0.01"
          value={form.monthlyAmount}
          onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })}
          required
        />
        <Textarea label="Notas" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : (provider ? 'Guardar' : 'Crear')}</Button>
        </div>
      </form>
    </Modal>
  )
}

function StandaloneCostModal({ isOpen, onClose, onSave }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [form, setForm] = useState({ concept: '', amount: '', date: today })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) setForm({ concept: '', amount: '', date: today })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await addExtraCost({ employeeId: null, concept: form.concept, amount: Number(form.amount), date: form.date })
      onSave()
      onClose()
    } catch (err) {
      alert('Error al guardar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Gasto extraordinario (sin empleado)">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Concepto" value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} placeholder="Ej: Consultoría" required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Monto" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Agregar'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function EmployeeFichaModal({ isOpen, employee, onClose, onChanged, onDelete }) {
  const [adjForm, setAdjForm] = useState(null)
  const [extraForm, setExtraForm] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!employee) return null

  const cur = currentSalary(employee.adjustments)
  const liquido = cur ? cur.liquido : 0
  const costo = monthlyCostBreakdown(liquido, employee.hasIrpf)
  const extra12 = extraordinarios12m(employee.extraCosts)

  const today = format(new Date(), 'yyyy-MM-dd')

  const submitAdjustment = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (adjForm.id) {
        await updateSalaryAdjustment(adjForm.id, {
          liquido: Number(adjForm.liquido),
          effectiveDate: adjForm.effectiveDate,
          notes: adjForm.notes
        })
      } else {
        await addSalaryAdjustment(employee.id, {
          liquido: Number(adjForm.liquido),
          effectiveDate: adjForm.effectiveDate,
          notes: adjForm.notes
        })
      }
      setAdjForm(null)
      onChanged()
    } catch (err) {
      alert('Error al registrar ajuste: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitEdit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await updateEmployee(employee.id, {
        name: editForm.name,
        role: editForm.role,
        semesterAdjustmentPct: Number(editForm.semesterAdjustmentPct) || 3.5,
        hasIrpf: editForm.hasIrpf
      })
      setEditForm(null)
      onChanged()
    } catch (err) {
      alert('Error al editar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async () => {
    setBusy(true)
    try {
      await updateEmployee(employee.id, { active: !employee.active })
      onChanged()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitExtra = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await addExtraCost({
        employeeId: employee.id,
        type: extraForm.type,
        concept: extraForm.concept,
        amount: Number(extraForm.amount),
        date: extraForm.date
      })
      setExtraForm(null)
      onChanged()
    } catch (err) {
      alert('Error al guardar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeAdjustment = async (id) => {
    if (employee.adjustments.length <= 1) {
      alert('No se puede borrar el único ajuste de sueldo del empleado.')
      return
    }
    if (!window.confirm('¿Eliminar este ajuste de sueldo del histórico?')) return
    setBusy(true)
    try {
      await deleteSalaryAdjustment(id)
      onChanged()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeExtra = async (id) => {
    if (!window.confirm('¿Eliminar este gasto extraordinario?')) return
    setBusy(true)
    try {
      await deleteExtraCost(id)
      onChanged()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={employee.name}>
      <div className="space-y-6">
        {editForm && (
          <form onSubmit={submitEdit} className="bg-gray-50 rounded-lg p-3 space-y-3">
            <Input label="Nombre" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <Input label="Rol" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} placeholder="Ej: Coordinadora" />
            <Input label="Ajuste semestral (%)" type="number" step="0.1" value={editForm.semesterAdjustmentPct} onChange={(e) => setEditForm({ ...editForm, semesterAdjustmentPct: e.target.value })} />
            <Checkbox
              label="Aporta IRPF (cambia el nominal derivado)"
              checked={editForm.hasIrpf}
              onChange={(e) => setEditForm({ ...editForm, hasIrpf: e.target.checked })}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditForm(null)}>Cancelar</Button>
              <Button type="submit" disabled={busy}>Guardar</Button>
            </div>
          </form>
        )}
        {/* Header: costo anual mensualizado + desglose */}
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-500">Costo mensual a la compañía (plano todo el año)</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(costo.total)}</p>
          <div className="mt-3 space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>Líquido {employee.hasIrpf ? '(aporta IRPF)' : '(sin IRPF)'}</span>
              <span className="font-medium text-gray-900">{formatCurrency(liquido)}</span>
            </div>
            <div className="flex justify-between">
              <span>Nominal (líquido / {employee.hasIrpf ? '0,781' : '0,804'})</span>
              <span className="font-medium text-gray-900">{formatCurrency(costo.nominal)}</span>
            </div>
            <div className="flex justify-between"><span>+ Aportes patronales (12,6%)</span><span>{formatCurrency(costo.aportes)}</span></div>
            <div className="flex justify-between"><span>+ Aguinaldo mensualizado</span><span>{formatCurrency(costo.aguinaldo)}</span></div>
            <div className="flex justify-between"><span>+ Salario vacacional</span><span>{formatCurrency(costo.vacacional)}</span></div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Extraord. últimos 12m: {formatCurrency(extra12)} (se cobran en su mes, no se prorratean)
          </p>
        </div>

        {/* Sueldo: historia de ajustes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Sueldo (historia)</h4>
            <button className="text-xs text-blue-600 hover:underline" onClick={() => setAdjForm({ id: null, liquido: '', effectiveDate: today, notes: '' })}>
              + Registrar ajuste
            </button>
          </div>
          {adjForm && (
            <form onSubmit={submitAdjustment} className="bg-blue-50 rounded-lg p-3 mb-3 space-y-3">
              <Input label="Sueldo líquido" type="number" min="0" step="0.01" value={adjForm.liquido} onChange={(e) => setAdjForm({ ...adjForm, liquido: e.target.value })} required />
              <Input
                label="Vigente desde (mes)"
                type="month"
                value={String(adjForm.effectiveDate).slice(0, 7)}
                onChange={(e) => setAdjForm({ ...adjForm, effectiveDate: e.target.value ? `${e.target.value}-01` : '' })}
                required
              />
              <DerivedSalaryPreview liquido={adjForm.liquido} hasIrpf={employee.hasIrpf} />
              <Input label="Notas" value={adjForm.notes} onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setAdjForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={busy}>Guardar</Button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {employee.adjustments.map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <span className="font-medium text-gray-900">{formatCurrency(a.liquido)}</span>
                  <span className="text-gray-400"> líquido · {formatCurrency(monthlyCostBreakdown(a.liquido, employee.hasIrpf).total)} costo</span>
                  {a.notes && <span className="text-gray-400"> · {a.notes}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    desde {format(parseDateOnly(a.effectiveDate), 'MMM yyyy', { locale: es })}
                  </span>
                  <button
                    onClick={() => setAdjForm({ id: a.id, liquido: String(a.liquido), effectiveDate: a.effectiveDate, notes: a.notes || '' })}
                    className="p-1 text-gray-300 hover:text-indigo-600 rounded"
                    title="Editar líquido y mes de vigencia"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeAdjustment(a.id)} className="p-1 text-gray-300 hover:text-red-600 rounded">
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Extraordinarios del empleado */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Extraordinarios</h4>
            <button className="text-xs text-blue-600 hover:underline" onClick={() => setExtraForm({ type: 'otro', concept: '', amount: '', date: today })}>
              + Agregar
            </button>
          </div>
          {extraForm && (
            <form onSubmit={submitExtra} className="bg-purple-50 rounded-lg p-3 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                  <select
                    value={extraForm.type}
                    onChange={(e) => setExtraForm({ ...extraForm, type: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {EXTRA_COST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <Input label="Monto" type="number" value={extraForm.amount} onChange={(e) => setExtraForm({ ...extraForm, amount: e.target.value })} required />
              </div>
              <Input label="Concepto" value={extraForm.concept} onChange={(e) => setExtraForm({ ...extraForm, concept: e.target.value })} />
              <Input label="Fecha" type="date" value={extraForm.date} onChange={(e) => setExtraForm({ ...extraForm, date: e.target.value })} required />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setExtraForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={busy}>Guardar</Button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {employee.extraCosts.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <span className="font-medium text-gray-900">{extraCostLabel(c.type)}</span>
                  {c.concept && <span className="text-gray-400"> · {c.concept}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{formatCurrency(c.amount)}</span>
                  <span className="text-xs text-gray-400">{format(parseDateOnly(c.date), 'd MMM yyyy', { locale: es })}</span>
                  <button onClick={() => removeExtra(c.id)} className="p-1 text-gray-300 hover:text-red-600 rounded">
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer: acciones de ficha */}
        <div className="flex justify-between items-center pt-2 border-t border-gray-100">
          <div className="flex gap-4">
            <button
              onClick={() => setEditForm({ name: employee.name, role: employee.role || '', semesterAdjustmentPct: String(employee.semesterAdjustmentPct), hasIrpf: employee.hasIrpf })}
              className="text-sm text-blue-600 hover:underline"
            >
              Editar
            </button>
            <button onClick={toggleActive} disabled={busy} className="text-sm text-amber-700 hover:underline">
              {employee.active ? 'Dar de baja' : 'Reactivar'}
            </button>
          </div>
          <button onClick={() => onDelete(employee.id)} className="text-sm text-red-600 hover:underline">
            Eliminar empleado
          </button>
        </div>
      </div>
    </Modal>
  )
}
