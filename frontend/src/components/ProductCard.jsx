import { useState } from 'react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { money, resolveImage } from '../api'

function Stars({ rating }) {
  const r = Math.min(5, Math.max(0, rating || 0))
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={`star${i <= Math.floor(r) ? ' star--on' : i - 0.5 <= r ? ' star--half' : ''}`}>★</span>
      ))}
    </div>
  )
}

export default function ProductCard({ product }) {
  const { addItem, busy } = useCart()
  const { user } = useAuth()
  const [added, setAdded] = useState(false)

  const img = resolveImage(product.image_url)
  const price = money(product.price_cents)
  const [whole, frac] = price.split('.')
  const outOfStock = product.stock <= 0
  const lowStock = !outOfStock && product.stock <= 5

  const handleAdd = async () => {
    if (!user) return
    await addItem(product.id)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <article className="product-card">
      <div className="product-card-img-wrap">
        {img
          ? <img className="product-card-img" src={img} alt={product.name} loading="lazy" />
          : (
            <div className="product-card-img-ph">
              <span>{(product.category || product.name || 'P').slice(0, 2).toUpperCase()}</span>
            </div>
          )
        }
        {outOfStock && <span className="product-badge product-badge--out">Out of Stock</span>}
        {!outOfStock && lowStock && (
          <span className="product-badge product-badge--low">Only {product.stock} left</span>
        )}
      </div>

      <div className="product-card-body">
        <span className="product-category">{product.category}</span>
        <h3 className="product-name">{product.name}</h3>
        {product.description && (
          <p className="product-desc">{product.description}</p>
        )}

        {product.rating != null && <Stars rating={product.rating} />}

        <div className="product-price">
          <sup>$</sup><span className="product-price-whole">{whole}</span><sup>{frac}</sup>
        </div>

        {outOfStock ? (
          <button className="add-btn add-btn--disabled" disabled>Out of Stock</button>
        ) : !user ? (
          <button className="add-btn add-btn--signin" disabled title="Sign in to add to cart">
            Sign in to shop
          </button>
        ) : (
          <button
            className={`add-btn${added ? ' add-btn--added' : ''}`}
            onClick={handleAdd}
            disabled={busy || added}
          >
            {added ? '✓ Added to Cart' : 'Add to Cart'}
          </button>
        )}
      </div>
    </article>
  )
}
