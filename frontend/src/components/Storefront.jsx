import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api'
import ProductCard from './ProductCard'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'stock-desc', label: 'Most Stock' },
]

export default function Storefront({ searchQuery }) {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [activeCategory, setActiveCategory] = useState('')
  const [sort, setSort] = useState('newest')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const debounceRef = useRef(null)

  const categoryLabel = (item) => (typeof item === 'string' ? item : item.category)

  const loadCategories = useCallback(async () => {
    try {
      const data = await api.getCategories()
      setCategories(data.categories || [])
    } catch { /* ignore */ }
  }, [])

  const loadProducts = useCallback(async ({ query, category, sortVal, inStock } = {}) => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (query) params.search = query
      if (category) params.category = category
      if (sortVal) params.sort = sortVal
      if (inStock) params.inStock = 'true'
      const data = await api.getProducts(params)
      setProducts(data.products || [])
    } catch (e) {
      setError(e.message)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadCategories()
    loadProducts()
  }, [loadCategories, loadProducts])

  // React to search query from Header (debounced)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      loadProducts({ query: searchQuery, category: activeCategory, sortVal: sort, inStock: inStockOnly })
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery, activeCategory, sort, inStockOnly, loadProducts])

  // Client-side price filter (cheaper than extra API call)
  const displayed = products.filter(p => {
    const price = (p.price_cents || 0) / 100
    if (minPrice !== '' && price < Number(minPrice)) return false
    if (maxPrice !== '' && price > Number(maxPrice)) return false
    return true
  })

  return (
    <div className="storefront">
      {/* ── Filters sidebar ── */}
      <aside className="sf-sidebar">
        <h3 className="sf-sidebar-title">Filters</h3>

        <div className="sf-filter-group">
          <h4 className="sf-filter-label">Category</h4>
          <label className="sf-radio">
            <input type="radio" name="cat" value="" checked={activeCategory === ''} onChange={() => setActiveCategory('')} />
            All
          </label>
          {categories.map(item => {
            const cat = categoryLabel(item)
            return (
              <label key={cat} className="sf-radio">
                <input type="radio" name="cat" value={cat} checked={activeCategory === cat} onChange={() => setActiveCategory(cat)} />
                {cat}
                {typeof item === 'object' && item.products != null && (
                  <span className="sf-cat-count">({item.products})</span>
                )}
              </label>
            )
          })}
        </div>

        <div className="sf-filter-group">
          <h4 className="sf-filter-label">Sort By</h4>
          {SORT_OPTIONS.map(o => (
            <label key={o.value} className="sf-radio">
              <input type="radio" name="sort" value={o.value} checked={sort === o.value} onChange={() => setSort(o.value)} />
              {o.label}
            </label>
          ))}
        </div>

        <div className="sf-filter-group">
          <h4 className="sf-filter-label">Price Range (USD)</h4>
          <div className="sf-price-row">
            <input
              type="number"
              className="sf-price-input"
              placeholder="Min"
              min={0}
              value={minPrice}
              onChange={e => setMinPrice(e.target.value)}
            />
            <span>—</span>
            <input
              type="number"
              className="sf-price-input"
              placeholder="Max"
              min={0}
              value={maxPrice}
              onChange={e => setMaxPrice(e.target.value)}
            />
          </div>
        </div>

        <div className="sf-filter-group">
          <label className="sf-checkbox">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={e => setInStockOnly(e.target.checked)}
            />
            In Stock Only
          </label>
        </div>
      </aside>

      {/* ── Product area ── */}
      <div className="sf-products">
        {searchQuery && (
          <p className="sf-results-label">
            Results for &quot;<strong>{searchQuery}</strong>&quot;
            {!loading && <span> — {displayed.length} product{displayed.length !== 1 ? 's' : ''}</span>}
          </p>
        )}

        {loading ? (
          <div className="sf-grid">
            {[...Array(8)].map((_, i) => <div key={i} className="product-card product-card--skeleton" />)}
          </div>
        ) : error ? (
          <div className="sf-empty">
            <p>Could not load products: {error}</p>
            <button className="sf-retry-btn" onClick={() => loadProducts({ query: searchQuery, category: activeCategory, sortVal: sort, inStock: inStockOnly })}>
              Retry
            </button>
          </div>
        ) : displayed.length === 0 ? (
          <div className="sf-empty">
            <p>No products match your filters.</p>
          </div>
        ) : (
          <div className="sf-grid">
            {displayed.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
